"use client";

import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Clock3,
  FileCheck2,
  FileText,
  History,
  Info,
  ListChecks,
  MessageSquareText,
  PauseCircle,
  Search,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { announce } from "@/components/ui/live-announcer";
import { Sheet } from "@/components/ui/sheet";
import { cn, fieldControlWithIcon, fieldIcon } from "@/components/ui-primitives";

import {
  ROWAN_SELECTED_SENDING_PREFERENCE,
  syntheticPathways,
  syntheticPlannedContacts,
  syntheticTeamMembers,
  syntheticTemplates,
} from "./fixtures";
import { CARING_CONTACT_MOCKUP_ROUTES } from "./routes";
import {
  MessagePreviewCard,
  OneWayBoundary,
  PatientIdentityStrip,
  PersonAvatar,
  productInset,
  ProductSection,
  productSectionHeadingPad,
  productSurface,
  ScheduleList,
  SectionHeading,
  StatusChip,
} from "./product-ui";

type TodayPageProps = {
  onReviewReferral: () => void;
  onOpenPatients: () => void;
  onOpenSchedule: () => void;
};

const sendingWindows = [
  { label: "Morning", time: "10:00 am AWST", planned: 8, active: 3 },
  { label: "Afternoon", time: "2:00 pm AWST", planned: 11, active: 5 },
  { label: "Early evening", time: "5:00 pm AWST", planned: 6, active: 1 },
] as const;

const recentActivity = [
  { initials: "RS", name: "Rowan Sample", event: "Transport receipt recorded", time: "10:42 am", state: "Delivered" },
  { initials: "TR", name: "Taylor Rivera", event: "Schedule updated", time: "10:15 am", state: "Scheduled" },
  { initials: "JW", name: "Jordan White", event: "Agreement evidence added", time: "9:58 am", state: "Completed" },
  {
    initials: "AK",
    name: "Avery Khan",
    event: "Transport status unavailable",
    time: "9:20 am",
    state: "Requires action",
  },
] as const;

export function TodayProductPage({ onReviewReferral, onOpenPatients, onOpenSchedule }: TodayPageProps) {
  return (
    <div className="space-y-5" data-testid="caring-contact-screen-today">
      <div className="grid min-w-0 gap-5 lg:grid-cols-2">
        <ProductSection
          labelledBy="today-referrals-heading"
          className="overflow-hidden border-[color:var(--clinical-accent-border)] shadow-[var(--rule-accent)]"
        >
          <SectionHeading
            id="today-referrals-heading"
            title="Referrals to review"
            description="Ordered by the next eligible contact window after discharge."
            action={<StatusChip tone="info">3 new</StatusChip>}
            className={productSectionHeadingPad}
          />
          <article
            className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6"
            data-testid="pending-referral-SYN-REFERRAL-002"
          >
            <div className="flex min-w-0 items-start gap-3">
              <PersonAvatar initials="RS" size="lg" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-semibold text-[color:var(--text-heading)]">Rowan Sample</h3>
                  <StatusChip tone="info">Ready for activation</StatusChip>
                </div>
                <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                  Referral accepted 9:35 am · first window 10:00 am AWST
                </p>
                <p className="mt-2 text-sm font-medium text-[color:var(--text)]">
                  Example Aftercare Team owns the referral; Alex Example coordinates the plan.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end">
              <Button
                variant="primary"
                trailingIcon={ArrowRight}
                onClick={onReviewReferral}
                aria-label="Review Rowan Sample plan setup"
                className="w-full sm:w-auto"
              >
                Review plan setup
              </Button>
            </div>
          </article>
        </ProductSection>

        <ProductSection labelledBy="today-action-heading" className="overflow-hidden">
          <SectionHeading
            id="today-action-heading"
            title="Needs action"
            description="Observable operational work with an owner and remedy."
            action={<StatusChip tone="warning">2 items</StatusChip>}
            className={productSectionHeadingPad}
          />
          <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
            <button
              type="button"
              onClick={onOpenPatients}
              className="flex min-h-tap w-full items-start gap-3 px-5 py-4 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)] sm:px-6"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--warning-soft)] text-[color:var(--warning-text)] forced-colors:border forced-colors:border-[CanvasText]">
                <Clock3 aria-hidden="true" className="size-icon-md" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[color:var(--text-heading)]">Unclaimed referral</span>
                <span className="mt-1 block text-sm text-[color:var(--text-muted)]">
                  2 referrals need a coordinator.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="mt-2 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </button>
            <button
              type="button"
              onClick={onOpenPatients}
              className="flex min-h-tap w-full items-start gap-3 px-5 py-4 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)] sm:px-6"
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[color:var(--warning-soft)] text-[color:var(--warning-text)] forced-colors:border forced-colors:border-[CanvasText]">
                <ClipboardCheck aria-hidden="true" className="size-icon-md" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-[color:var(--text-heading)]">Agreement evidence missing</span>
                <span className="mt-1 block text-sm text-[color:var(--text-muted)]">
                  1 referral needs source clarification.
                </span>
              </span>
              <ChevronRight aria-hidden="true" className="mt-2 size-icon-md shrink-0 text-[color:var(--text-muted)]" />
            </button>
          </div>
        </ProductSection>
      </div>

      <ProductSection labelledBy="sending-today-heading" className="overflow-hidden">
        <SectionHeading
          id="sending-today-heading"
          title="Sending today"
          description="Routine sending windows in Australia/Perth."
          icon={CalendarClock}
          action={
            <Button variant="ghost" size="sm" trailingIcon={ChevronRight} onClick={onOpenSchedule}>
              View schedule
            </Button>
          }
          className={productSectionHeadingPad}
        />
        <div className="grid min-w-0 border-t border-[color:var(--border)] sm:grid-cols-3">
          {sendingWindows.map((window, index) => (
            <article
              key={window.label}
              className={cn(
                "min-w-0 px-5 py-5 sm:px-6",
                index > 0 && "border-t border-[color:var(--border)] sm:border-l sm:border-t-0",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold text-[color:var(--text-heading)]">{window.label}</p>
                  <p className="mt-1 text-sm tabular-nums text-[color:var(--text-muted)]">{window.time}</p>
                </div>
                <CalendarDays aria-hidden="true" className="size-icon-lg text-[color:var(--clinical-accent)]" />
              </div>
              <dl className="mt-5 grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-[color:var(--text-muted)]">Planned</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text-heading)]">
                    {window.planned}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[color:var(--text-muted)]">Processing</dt>
                  <dd className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--clinical-accent)]">
                    {window.active}
                  </dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </ProductSection>

      <ProductSection labelledBy="recent-activity-heading" className="overflow-hidden">
        <SectionHeading
          id="recent-activity-heading"
          title="Recent activity"
          description="Operational actions only—no message or clinical detail."
          icon={History}
          className={productSectionHeadingPad}
        />
        <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
          {recentActivity.map((item) => (
            <div
              key={`${item.name}-${item.event}`}
              className="grid min-w-0 gap-2 px-5 py-3 sm:flex sm:items-center sm:gap-4 sm:px-6"
            >
              <PersonAvatar initials={item.initials} size="sm" />
              <p className="font-semibold text-[color:var(--text-heading)] sm:w-40 sm:shrink-0">{item.name}</p>
              <p className="text-sm text-[color:var(--text-muted)] sm:min-w-0 sm:flex-1">{item.event}</p>
              <time className="text-sm tabular-nums text-[color:var(--text-muted)] sm:w-24 sm:shrink-0">
                {item.time}
              </time>
              <StatusChip
                tone={
                  item.state === "Delivered" || item.state === "Completed"
                    ? "success"
                    : item.state === "Requires action"
                      ? "warning"
                      : "neutral"
                }
              >
                {item.state}
              </StatusChip>
            </div>
          ))}
        </div>
      </ProductSection>

      <section
        aria-labelledby="operational-summary-heading"
        className="grid gap-3 border-t border-[color:var(--border)] pt-5 sm:grid-cols-3"
      >
        <h2 id="operational-summary-heading" className="sr-only">
          Operational summary
        </h2>
        {[
          ["Active plans", "14", "Across the selected team"],
          ["Due today", "25", "All three sending windows"],
          ["Named exceptions", "1", "Requires operational review"],
        ].map(([label, value, note]) => (
          <div key={label} className="min-w-0 px-2 py-2">
            <p className="text-sm font-medium text-[color:var(--text-muted)]">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text-heading)]">{value}</p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">{note}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

type PatientsDirectoryProps = {
  onOpenRowan: () => void;
  onContinueMira: () => void;
};

const patientRows = [
  {
    initials: "ME",
    name: "Mira Example",
    id: "SYN-PATIENT-002",
    status: "Awaiting handover",
    owner: "Fictional Ward A",
    action: "Continue referral",
  },
  {
    initials: "RS",
    name: "Rowan Sample",
    id: "SYN-PATIENT-001",
    status: "Active plan",
    owner: "Alex Example",
    action: "View patient",
  },
  {
    initials: "SW",
    name: "Sam Wilson",
    id: "SYN-PATIENT-003",
    status: "Needs action",
    owner: "Taylor Fiction",
    action: "Review exception",
  },
] as const;

export function PatientsDirectoryPage({ onOpenRowan, onContinueMira }: PatientsDirectoryProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"All states" | (typeof patientRows)[number]["status"]>("All states");
  const filteredRows = useMemo(
    () =>
      patientRows.filter(
        (row) =>
          `${row.name} ${row.id}`.toLowerCase().includes(query.trim().toLowerCase()) &&
          (statusFilter === "All states" || row.status === statusFilter),
      ),
    [query, statusFilter],
  );

  return (
    <div className="space-y-5" data-testid="caring-contact-screen-patients">
      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Active patients", "14", "One current plan each"],
          ["Awaiting handover", "3", "Referring team remains responsible"],
          ["Needs action", "2", "Named operational conditions"],
        ].map(([label, value, note]) => (
          <div key={label} className={cn(productSurface, "px-4 py-4 sm:px-5")}>
            <p className="text-sm font-medium text-[color:var(--text-muted)]">{label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[color:var(--text-heading)]">{value}</p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">{note}</p>
          </div>
        ))}
      </div>

      <ProductSection labelledBy="patient-directory-heading" className="overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <h2
              id="patient-directory-heading"
              className="text-lg font-semibold tracking-tight text-[color:var(--text-heading)]"
            >
              Active-team patients
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Search is limited to referrals and episodes owned by Example Aftercare Team.
            </p>
          </div>
          <div className="grid w-full gap-3 sm:max-w-xl sm:flex">
            <div className="relative min-w-0 sm:flex-1">
              <label htmlFor="caring-contact-patient-search" className="sr-only">
                Search active team patients
              </label>
              <Search aria-hidden="true" className={fieldIcon} />
              <input
                id="caring-contact-patient-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name or synthetic ID"
                autoComplete="off"
                className={fieldControlWithIcon}
              />
            </div>
            <div className="min-w-0 sm:w-48 sm:shrink-0">
              <label htmlFor="caring-contact-patient-filter" className="sr-only">
                Filter by patient state
              </label>
              <select
                id="caring-contact-patient-filter"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as "All states" | (typeof patientRows)[number]["status"])
                }
                className="min-h-tap w-full rounded-[var(--radius-md)] border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] px-3 text-sm text-[color:var(--text)] shadow-[var(--shadow-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
              >
                <option>All states</option>
                <option>Active plan</option>
                <option>Awaiting handover</option>
                <option>Needs action</option>
              </select>
            </div>
          </div>
        </div>
        <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
          {filteredRows.map((row) => (
            <article key={row.id} className="grid min-w-0 gap-3 px-5 py-4 sm:flex sm:items-center sm:px-6">
              <PersonAvatar initials={row.initials} />
              <div className="min-w-0 sm:w-44 sm:shrink-0">
                <h3 className="truncate font-semibold text-[color:var(--text-heading)]">{row.name}</h3>
                <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)]">{row.id}</p>
              </div>
              <StatusChip
                tone={row.status === "Active plan" ? "success" : row.status === "Needs action" ? "warning" : "info"}
              >
                {row.status}
              </StatusChip>
              <p className="text-sm text-[color:var(--text-muted)] sm:min-w-0 sm:flex-1">Owner: {row.owner}</p>
              <Button
                variant="secondary"
                size="sm"
                trailingIcon={ChevronRight}
                onClick={
                  row.name === "Rowan Sample"
                    ? onOpenRowan
                    : row.name === "Mira Example"
                      ? onContinueMira
                      : () => announce("Synthetic exception selected", { eventId: "caring-contact:patient-exception" })
                }
              >
                {row.action}
              </Button>
            </article>
          ))}
          {filteredRows.length === 0 ? (
            <div className="px-5 py-10 text-center sm:px-6">
              <p className="font-semibold text-[color:var(--text-heading)]">No active-team patients match</p>
              <p className="mt-1 text-sm text-[color:var(--text-muted)]">
                Try a different fictional name or identifier.
              </p>
            </div>
          ) : null}
        </div>
      </ProductSection>
    </div>
  );
}

export function PatientOverviewProductPage({ onViewPlan }: { onViewPlan: () => void }) {
  return (
    <div className="space-y-5" data-testid="caring-contact-screen-patient-overview">
      <PatientIdentityStrip />

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Active plan", syntheticPathways[0].name, "10 contacts over 12 months"],
          ["Next contact", "Week 1 · 22 Aug", ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel],
          ["Continuity", "1 delivered · 9 scheduled", "Original cadence preserved"],
        ].map(([label, value, note]) => (
          <div key={label} className={cn(productSurface, "px-4 py-4 sm:px-5")}>
            <p className="text-xs font-semibold uppercase tracking-[var(--tracking-eyebrow)] text-[color:var(--text-muted)]">
              {label}
            </p>
            <p className="mt-2 font-semibold text-[color:var(--text-heading)]">{value}</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">{note}</p>
          </div>
        ))}
      </div>

      <ProductSection labelledBy="continuity-heading" className="overflow-hidden">
        <SectionHeading
          id="continuity-heading"
          title="Twelve-month continuity"
          description="Spacing shows elapsed schedule only; geometry never represents patient or clinical state."
          action={
            <Button variant="secondary" size="sm" onClick={onViewPlan}>
              View plan
            </Button>
          }
          className={productSectionHeadingPad}
        />
        <div className="border-t border-[color:var(--border)] px-5 py-5 sm:px-6">
          <ol
            aria-label="Ten-contact continuity"
            className="grid grid-cols-2 gap-2 xl:hidden"
            data-testid="caring-contact-continuity-compact"
          >
            {syntheticPlannedContacts.map((contact, index) => (
              <li
                key={contact.id}
                className="flex min-w-0 items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3"
              >
                <span
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                    index === 0
                      ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                      : "border-[color:var(--clinical-accent)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]",
                  )}
                >
                  {contact.sequence}
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-[color:var(--text-heading)]">
                    {contact.cadenceLabel}
                  </span>
                  <span className="mt-0.5 block text-xs leading-4 text-[color:var(--text-muted)]">
                    {contact.transportState}
                  </span>
                </span>
              </li>
            ))}
          </ol>
          {/*
            The wide strip appears only once it FITS, which `md:` was not.

            Its inner row is `min-w-[46rem]` (736px). At the `md:` breakpoint the content column is
            768 - 80 rail - 48 main gutter - 48 card padding = about 592px, so the strip arrived
            144px too wide and immediately became a nested horizontal scroller inside a card — and
            it did so at exactly the width where the readable two-column version below it was
            switched off. It needs roughly 1128px of viewport to fit, so `xl:` (1280) is the first
            named breakpoint that can hold it; the compact grid covers everything below.
          */}
          <div
            aria-label="Ten-contact continuity"
            className="hidden overflow-x-auto polished-scroll xl:block"
            data-testid="caring-contact-continuity-wide"
          >
            <div className="flex min-w-[46rem] items-start">
              {syntheticPlannedContacts.map((contact, index) => (
                <div key={contact.id} className="flex min-w-0 flex-1 items-start">
                  <div className="flex w-full min-w-0 flex-col items-center text-center">
                    <span
                      className={cn(
                        "grid size-8 place-items-center rounded-full border text-xs font-semibold",
                        index === 0
                          ? "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]"
                          : "border-[color:var(--clinical-accent)] bg-[color:var(--surface)] text-[color:var(--clinical-accent)]",
                      )}
                    >
                      {contact.sequence}
                    </span>
                    <span className="mt-2 text-xs font-semibold text-[color:var(--text-heading)]">
                      {contact.cadenceLabel}
                    </span>
                    <span className="mt-0.5 text-xs text-[color:var(--text-muted)]">{contact.transportState}</span>
                  </div>
                  {index < syntheticPlannedContacts.length - 1 ? (
                    <span className="mt-4 h-px min-w-2 flex-1 bg-[color:var(--clinical-accent-border)]" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
          <p className="mt-4 text-xs text-[color:var(--text-muted)]">One-way caring contacts · Morning 10:00 am AWST</p>
        </div>
      </ProductSection>

      <div className="grid gap-5 lg:grid-cols-2">
        <ProductSection labelledBy="next-contacts-heading" className="overflow-hidden">
          <SectionHeading
            id="next-contacts-heading"
            title="Next three contacts"
            icon={CalendarDays}
            className={productSectionHeadingPad}
          />
          <div className="border-t border-[color:var(--border)]">
            <ScheduleList limit={3} />
          </div>
        </ProductSection>
        <ProductSection labelledBy="chronology-heading" className="overflow-hidden">
          <SectionHeading
            id="chronology-heading"
            title="Chronology"
            icon={History}
            className={productSectionHeadingPad}
          />
          <ol className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] px-5">
            {[
              ["Transport receipt recorded", "15 Aug 2026, 10:00 am AWST", "Delivered"],
              ["Coordination claimed", "15 Aug 2026, 9:42 am AWST", "Alex Example"],
              ["Referral accepted", "15 Aug 2026, 9:35 am AWST", "Taylor Fiction"],
            ].map(([event, time, detail]) => (
              <li key={event} className="py-3">
                <div className="flex items-start gap-3">
                  <CheckCircle2
                    aria-hidden="true"
                    className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[color:var(--text-heading)]">{event}</p>
                    <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">
                      {time} · {detail}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
          <p className="border-t border-[color:var(--border)] px-5 py-3 text-xs text-[color:var(--text-muted)]">
            Delivered is transport receipt only.
          </p>
        </ProductSection>
      </div>
    </div>
  );
}

export function PlanDetailProductPage({
  onOpenException,
  onOpenOverlay,
  status = "Active",
  coordinator = "Alex Example",
}: {
  onOpenException: () => void;
  onOpenOverlay?: (overlayId: string) => void;
  status?: "Draft" | "Active" | "Paused" | "Withdrawn";
  coordinator?: string;
}) {
  // What the plan's own state means for what may be done to it, named once so the panel below
  // reads as the two facts it depends on rather than as a chain of string comparisons.
  const planHasEnded = status === "Withdrawn";
  const planIsSending = status === "Active" || status === "Paused";

  const [pauseOpen, setPauseOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [notice, setNotice] = useState("");

  function recordPrototypeOutcome(message: string) {
    setPauseOpen(false);
    setWithdrawOpen(false);
    setNotice(message);
    announce(message, { eventId: "caring-contact:plan-action" });
  }

  return (
    <div className="space-y-5" data-testid="caring-contact-screen-plan-detail">
      <div
        className={cn(
          productSurface,
          "overflow-hidden border-[color:var(--clinical-accent-border)] shadow-[var(--rule-accent)]",
        )}
      >
        <div className="grid gap-4 px-5 py-5 sm:grid-cols-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <PersonAvatar initials="RS" />
            <div className="min-w-0">
              <p className="truncate font-semibold text-[color:var(--text-heading)]">Rowan Sample</p>
              <p className="mt-0.5 truncate text-sm text-[color:var(--text-muted)]">SYN-PATIENT-001</p>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-[color:var(--text-muted)]">Plan</p>
            <p className="mt-1 font-semibold text-[color:var(--text-heading)]">
              Twelve-month caring contact · 10 contacts
            </p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              One-way SMS · {ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-[color:var(--text-muted)]">Status</p>
            <div className="mt-1">
              {/*
                Four states, four readings. `Draft` and `Paused` both fell through to `neutral`
                before, so a plan that has never sent anything looked identical to one that is
                running and temporarily held — the two are operationally opposite, and the chip is
                the fastest thing on this screen to read. `warning` marks the held plan, which is
                the one a coordinator may need to act on; `info` marks the draft, which is simply
                not started. The word is still the primary signal in every case.
              */}
              <StatusChip
                tone={
                  status === "Active"
                    ? "success"
                    : status === "Withdrawn"
                      ? "danger"
                      : status === "Paused"
                        ? "warning"
                        : "info"
                }
              >
                {status}
              </StatusChip>
            </div>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">Started 15 Aug 2026</p>
          </div>
        </div>
      </div>

      <OneWayBoundary />

      <div className="grid min-w-0 gap-5 xl:grid-cols-3">
        <div className="space-y-5">
          <ProductSection labelledBy="plan-summary-heading" className="overflow-hidden">
            <SectionHeading id="plan-summary-heading" title="Plan summary" compact />
            <dl className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] px-4 text-sm">
              {[
                ["Template", `${syntheticPathways[0].name} · ${syntheticPathways[0].version}`],
                ["Total contacts", "10"],
                ["Cadence", "Day 1 to month 12"],
                ["Next contact", "22 Aug 2026"],
                ["Time zone", "AWST (UTC+8)"],
              ].map(([term, value]) => (
                <div key={term} className="grid grid-cols-[minmax(6.5rem,0.8fr)_minmax(0,1.2fr)] gap-3 py-3">
                  <dt className="text-[color:var(--text-muted)]">{term}</dt>
                  <dd className="font-medium text-[color:var(--text)]">{value}</dd>
                </div>
              ))}
            </dl>
          </ProductSection>
          <ProductSection labelledBy="plan-owner-heading" className="overflow-hidden">
            <SectionHeading id="plan-owner-heading" title="Ownership" compact />
            <div className="border-t border-[color:var(--border)] px-4 py-4 text-sm">
              <p className="font-semibold text-[color:var(--text-heading)]">{coordinator}</p>
              <p className="mt-1 text-[color:var(--text-muted)]">Coordinator · Example Aftercare Team</p>
              <p className="mt-3 text-xs text-[color:var(--text-muted)]">Backup owner: Sam Sample</p>
            </div>
          </ProductSection>
        </div>

        <ProductSection labelledBy="plan-timeline-heading" className="overflow-hidden">
          <SectionHeading
            id="plan-timeline-heading"
            title="Plan timeline"
            icon={CalendarDays}
            className={productSectionHeadingPad}
          />
          <div className="border-t border-[color:var(--border)]">
            <ScheduleList />
          </div>
        </ProductSection>

        <ProductSection labelledBy="plan-actions-heading" className="h-fit overflow-hidden">
          <SectionHeading id="plan-actions-heading" title="Plan actions" compact />
          {/*
            The panel answers the plan's OWN state. Until now only `status === "Paused"` was read,
            and only to relabel one button: a Withdrawn plan still offered a live "Pause plan" and
            a live "Record withdrawal" — the second of which this screen's own confirmation copy
            describes as permanently cancelling every unsent contact, on a plan where that has
            already happened. A Draft plan, which has not started sending, still offered "Open
            delivery exception" for deliveries that cannot exist yet.

            A plan that has ended is the terminal state, so its controls go and a sentence says why
            rather than leaving an empty panel. `aria-disabled` is not the tool here: these are not
            temporarily unavailable, they are not part of this plan's life any more.
          */}
          <div className="space-y-3 border-t border-[color:var(--border)] p-4">
            {planHasEnded ? (
              <p className="text-sm leading-6 text-[color:var(--text-muted)]">
                This plan is withdrawn. Nothing further is sent on it and it cannot be paused, withdrawn again or
                reassigned.
              </p>
            ) : (
              <>
                <Button
                  variant="secondary"
                  icon={PauseCircle}
                  block
                  onClick={() => (onOpenOverlay ? onOpenOverlay("pause") : setPauseOpen(true))}
                >
                  {status === "Paused" ? "Resume plan" : "Pause plan"}
                </Button>
                <Button
                  variant="secondary"
                  icon={XCircle}
                  block
                  onClick={() => (onOpenOverlay ? onOpenOverlay("withdrawal") : setWithdrawOpen(true))}
                >
                  Record withdrawal
                </Button>
                {onOpenOverlay ? (
                  <Button variant="secondary" icon={Users} block onClick={() => onOpenOverlay("reassignment")}>
                    Reassign coordinator
                  </Button>
                ) : null}
                {planIsSending ? (
                  <Button variant="secondary" icon={AlertTriangle} block onClick={onOpenException}>
                    Open delivery exception
                  </Button>
                ) : null}
                <p className="text-xs leading-5 text-[color:var(--text-muted)]">
                  {planIsSending
                    ? "Pause preserves the original calendar and skips contacts that fall inside the pause."
                    : "This plan has not started sending, so there are no deliveries to raise an exception against."}
                </p>
              </>
            )}
            {notice ? (
              <p className="rounded-[var(--radius-md)] bg-[color:var(--clinical-accent-soft)] p-3 text-xs font-medium text-[color:var(--clinical-accent)]">
                {notice}
              </p>
            ) : null}
          </div>
        </ProductSection>
      </div>

      <ConfirmDialog
        open={!onOpenOverlay && pauseOpen}
        onCancel={() => setPauseOpen(false)}
        onConfirm={() => recordPrototypeOutcome("Prototype pause reviewed. The synthetic plan was not changed.")}
        title="Pause caring-contact plan"
        description="Future contacts inside the pause would be skipped permanently. The original cadence would remain unchanged."
        confirmLabel="Pause future contacts"
        tone="primary"
      />
      <ConfirmDialog
        open={!onOpenOverlay && withdrawOpen}
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={() => recordPrototypeOutcome("Prototype withdrawal reviewed. The synthetic plan was not changed.")}
        title="Record patient-requested withdrawal"
        description="Withdrawal would permanently cancel every unsent contact. This prototype records no change."
        confirmLabel="Continue to fresh authentication"
        tone="danger"
      />
    </div>
  );
}

type DeliveryExceptionDrawerProps = { open: boolean; onClose: () => void };

export function DeliveryExceptionDrawer({ open, onClose }: DeliveryExceptionDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [reviewRecorded, setReviewRecorded] = useState(false);

  function closeDrawer() {
    setReviewRecorded(false);
    onClose();
  }

  function recordOperationalReview() {
    setReviewRecorded(true);
    announce("Prototype operational review recorded. No data changed.", {
      eventId: "caring-contact:exception-review",
    });
  }

  return (
    <Sheet
      open={open}
      onClose={closeDrawer}
      title="Permanent delivery exception"
      description="Contact 4 of 10 · scheduled 15 Oct 2026 at 10:00 am AWST"
      closeLabel="Close permanent delivery exception"
      initialFocusRef={closeRef}
      mobilePlacement="fullscreen"
      contentStyle={{
        position: "fixed",
        inset: "0 0 0 auto",
        width: "min(100%, 34rem)",
        maxWidth: "34rem",
        height: "100%",
        maxHeight: "100%",
      }}
      contentClassName="md:rounded-none"
      desktopBackdropClassName="md:items-stretch md:justify-end md:p-0"
      testId="caring-contact-delivery-exception"
      footer={
        <Button ref={closeRef} variant="secondary" block onClick={closeDrawer}>
          Close transport detail
        </Button>
      }
    >
      <div className="space-y-5">
        <StatusChip tone="danger">Not delivered</StatusChip>

        <div className={cn(productInset, "p-4")}>
          <div className="flex items-center gap-3">
            <PersonAvatar initials="RS" />
            <div>
              <p className="font-semibold text-[color:var(--text-heading)]">Rowan Sample</p>
              <p className="mt-0.5 text-sm text-[color:var(--text-muted)]">Synthetic patient · SYN-PATIENT-001</p>
            </div>
          </div>
          <dl className="mt-4 divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] text-sm">
            {[
              ["Plan", "Twelve-month caring contact · 10 contacts"],
              ["Message", "Contact 4 of 10"],
              ["Scheduled", "15 Oct 2026 · 10:00 am AWST"],
            ].map(([term, value]) => (
              <div key={term} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-3 py-3">
                <dt className="text-[color:var(--text-muted)]">{term}</dt>
                <dd className="font-medium text-[color:var(--text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <section aria-labelledby="delivery-attempts-heading" className={cn(productSurface, "overflow-hidden")}>
          <SectionHeading id="delivery-attempts-heading" title="Delivery attempts" compact />
          <ol className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] px-4">
            {["10:00 am", "1:00 pm", "5:00 pm"].map((time, index) => (
              <li key={time} className="flex items-start gap-3 py-3">
                <AlertTriangle
                  aria-hidden="true"
                  className="mt-0.5 size-icon-sm shrink-0 text-[color:var(--danger-text)] forced-colors:text-[CanvasText]"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[color:var(--text-heading)]">Attempt {index + 1}</p>
                  <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">15 Oct 2026 · {time} AWST</p>
                </div>
                <span className="text-xs font-medium text-[color:var(--danger-text)]">Not delivered</span>
              </li>
            ))}
          </ol>
        </section>

        <div className="rounded-[var(--radius-lg)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-icon-md shrink-0 text-[color:var(--warning-text)] forced-colors:text-[CanvasText]"
            />
            <div>
              <p className="font-semibold text-[color:var(--text-heading)]">This is a transport exception</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
                It does not indicate patient safety, receipt, wellbeing or response.
              </p>
            </div>
          </div>
        </div>

        <section aria-labelledby="same-day-task-heading" className={cn(productSurface, "overflow-hidden")}>
          <SectionHeading id="same-day-task-heading" title="Same-day operational task" compact />
          <div className="space-y-4 border-t border-[color:var(--border)] p-4">
            <p className="text-sm text-[color:var(--text-muted)]">
              Review the contact record and record an operational outcome today. No automated clinical action is
              created.
            </p>
            <Button variant="primary" block onClick={recordOperationalReview}>
              Record operational review
            </Button>
            {reviewRecorded ? (
              <p
                role="status"
                className="rounded-[var(--radius-md)] bg-[color:var(--success-soft)] p-3 text-sm font-medium text-[color:var(--success-text)]"
              >
                Prototype review recorded. The synthetic contact and plan remain unchanged.
              </p>
            ) : null}
          </div>
        </section>
      </div>
    </Sheet>
  );
}

const scheduleCounts = [5, 4, 7, 4, 6, 9, 3] as const;

const scheduleFullDateFormatter = new Intl.DateTimeFormat("en-AU", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Australia/Perth",
});

const scheduleDayFormatter = new Intl.DateTimeFormat("en-AU", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Australia/Perth",
});

function scheduleDateFor(dayOffset: number) {
  return new Date(Date.UTC(2026, 7, 10 + dayOffset));
}

function scheduleDateId(date: Date) {
  return date.toISOString().slice(0, 10);
}

const schedulePatients = {
  Morning: ["Rowan Sample", "Taylor Smith", "Jordan Lee", "Morgan Riley"],
  Afternoon: ["Casey Brown", "Avery Jones", "Jamie Paterson"],
  "Early evening": ["Reese Clark", "Alex Nguyen"],
} as const;

export function ScheduleProductPage({
  onOpenException,
  selectedDate: controlledSelectedDate,
  onSelectedDateChange,
}: {
  onOpenException: () => void;
  selectedDate?: string;
  onSelectedDateChange?: (date: string) => void;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [internalSelectedDate, setInternalSelectedDate] = useState("2026-08-15");
  const selectedDate = controlledSelectedDate ?? internalSelectedDate;

  function selectDate(date: string) {
    if (onSelectedDateChange) onSelectedDateChange(date);
    else setInternalSelectedDate(date);
  }
  const visibleDays = useMemo(
    () =>
      scheduleCounts.map((count, index) => {
        const date = scheduleDateFor(weekOffset * 7 + index);
        const [day, dateLabel, month] = scheduleDayFormatter.format(date).replace(",", "").split(" ");
        return { count, dateId: scheduleDateId(date), day, dateLabel, month };
      }),
    [weekOffset],
  );
  const selectedDateValue = new Date(`${selectedDate}T00:00:00+08:00`);
  const selectedHasException = selectedDate === "2026-08-15";

  function changeWeek(delta: number) {
    const nextOffset = weekOffset + delta;
    setWeekOffset(nextOffset);
    selectDate(scheduleDateId(scheduleDateFor(nextOffset * 7 + 5)));
  }

  return (
    <div className="space-y-5" data-testid="caring-contact-screen-schedule">
      <ProductSection labelledBy="schedule-day-heading" className="overflow-hidden">
        <div className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h2
              id="schedule-day-heading"
              className="text-lg font-semibold tracking-tight text-[color:var(--text-heading)]"
            >
              {scheduleFullDateFormatter.format(selectedDateValue)}
            </h2>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">Australia/Perth · approved service windows</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="toolbar"
              size="sm"
              icon={ChevronLeft}
              aria-label="Previous week"
              onClick={() => changeWeek(-1)}
            >
              Previous
            </Button>
            <Button
              variant="toolbar"
              size="sm"
              trailingIcon={ChevronRight}
              aria-label="Next week"
              onClick={() => changeWeek(1)}
            >
              Next
            </Button>
          </div>
        </div>
        <div
          className="grid border-t border-[color:var(--border)]"
          style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}
        >
          {visibleDays.map(({ count, dateId, day, dateLabel, month }) => {
            const selected = dateId === selectedDate;
            return (
              <button
                key={dateId}
                type="button"
                aria-pressed={selected}
                aria-label={`${day} ${dateLabel} ${month}, ${count} scheduled contacts`}
                onClick={() => selectDate(dateId)}
                className={cn(
                  "min-h-tap min-w-0 border-l border-[color:var(--border)] px-1 py-3 text-center first:border-l-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]",
                  selected
                    ? "bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]"
                    : "hover:bg-[color:var(--surface-subtle)]",
                )}
              >
                <span className="block text-xs font-medium">{day}</span>
                <span className="mt-1 block text-base font-semibold tabular-nums">{dateLabel}</span>
                <span className="hidden text-3xs text-[color:var(--text-muted)] sm:block">{month}</span>
                <span className="mt-1 block text-xs text-[color:var(--text-muted)]">{count}</span>
              </button>
            );
          })}
        </div>
      </ProductSection>

      <div className="grid min-w-0 gap-5 lg:grid-cols-3">
        {(Object.entries(schedulePatients) as Array<[keyof typeof schedulePatients, readonly string[]]>).map(
          ([window, patients], index) => (
            <ProductSection key={window} labelledBy={`schedule-${index}-heading`} className="overflow-hidden">
              <div className="flex items-start justify-between gap-3 px-5 py-4">
                <div>
                  <h2 id={`schedule-${index}-heading`} className="font-semibold text-[color:var(--text-heading)]">
                    {window}
                  </h2>
                  <p className="mt-1 text-sm tabular-nums text-[color:var(--text-muted)]">
                    {index === 0 ? "10:00 am" : index === 1 ? "2:00 pm" : "5:00 pm"} AWST
                  </p>
                </div>
                <Chip appearance={{ kind: "information", tone: "accent" }}>{patients.length}</Chip>
              </div>
              <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
                {patients.map((patient) => (
                  <button
                    key={patient}
                    type="button"
                    onClick={() =>
                      announce(`${patient} schedule record selected`, { eventId: `caring-contact:schedule:${patient}` })
                    }
                    className="flex min-h-tap w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]"
                  >
                    <span className="font-medium text-[color:var(--text)]">{patient}</span>
                    <span className="text-xs font-semibold text-[color:var(--clinical-accent)]">Standard</span>
                  </button>
                ))}
              </div>
            </ProductSection>
          ),
        )}
      </div>

      <ProductSection labelledBy="schedule-exceptions-heading" className="overflow-hidden">
        <SectionHeading
          id="schedule-exceptions-heading"
          title="Named exceptions"
          description="Kept separate from routine sending windows."
          icon={AlertTriangle}
          className={productSectionHeadingPad}
        />
        {selectedHasException ? (
          <button
            type="button"
            onClick={onOpenException}
            className="grid min-h-tap w-full min-w-0 gap-2 border-t border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] px-5 py-4 text-left hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)] sm:grid-cols-4 sm:items-center sm:px-6"
          >
            <span className="font-semibold text-[color:var(--text-heading)]">Sam Wilson</span>
            <span className="text-sm text-[color:var(--text-muted)]">Transport status unavailable</span>
            <span className="text-sm text-[color:var(--text-muted)]">15 Aug · Morning</span>
            <StatusChip tone="warning">Requires action</StatusChip>
          </button>
        ) : (
          <div className="border-t border-[color:var(--border)] px-5 py-8 text-center sm:px-6">
            <CheckCircle2 aria-hidden="true" className="mx-auto size-icon-lg text-[color:var(--success)]" />
            <p className="mt-2 font-semibold text-[color:var(--text-heading)]">No named exceptions for this day</p>
            <p className="mt-1 text-sm text-[color:var(--text-muted)]">
              Routine contacts remain visible in their approved sending windows.
            </p>
          </div>
        )}
      </ProductSection>
    </div>
  );
}

/**
 * One reviewer row, from the record's own approval evidence.
 *
 * These two rows used to be the literals `"Taylor Fiction"` and `"Jordan Example"`, rendered for
 * EVERY selected record — including the pending message template whose `approvalEvidence` is
 * `null` in the fixture precisely because nobody has reviewed it yet. So the panel named two
 * clinicians as approvers of a record two rows below a field reading "Not approved", on the one
 * screen in this prototype whose whole subject is governance provenance. A synthetic name is still
 * a claim about who signed something off, and it must not appear where no sign-off is recorded.
 *
 * The fixture's evidence string is `"<name> · <role> · approved <when>"`. The role is already the
 * row's own label, so it is dropped and the name and timestamp are kept — which also surfaces the
 * real per-record approval times that were previously unreachable.
 */
function reviewerLine(evidence: string | undefined): string {
  if (!evidence) return "Not recorded — no approval on this record";
  const [name, , approved] = evidence.split(" · ");
  return approved ? `${name} · ${approved}` : name;
}

const governedLibraryRecords = [
  {
    approvalEvidence: syntheticPathways[0].approvalEvidence,
    id: syntheticPathways[0].id,
    kind: "Pathway",
    name: syntheticPathways[0].name,
    version: syntheticPathways[0].version,
    lifecycle: syntheticPathways[0].lifecycle,
    approval: syntheticPathways[0].approvalState,
    detail: "12 months · 10 contacts",
  },
  {
    approvalEvidence: syntheticPathways[1].approvalEvidence,
    id: syntheticPathways[1].id,
    kind: "Pathway",
    name: syntheticPathways[1].name,
    version: syntheticPathways[1].version,
    lifecycle: syntheticPathways[1].lifecycle,
    approval: syntheticPathways[1].approvalState,
    detail: "12 months · historical record",
  },
  {
    approvalEvidence: syntheticTemplates[0].approvalEvidence,
    id: syntheticTemplates[0].id,
    kind: "Message",
    name: syntheticTemplates[0].name,
    version: syntheticTemplates[0].version,
    lifecycle: syntheticTemplates[0].lifecycle,
    approval: syntheticTemplates[0].approvalState,
    detail: `${syntheticTemplates[0].variant} · ${syntheticTemplates[0].segmentCount} segments`,
  },
  {
    approvalEvidence: syntheticTemplates[1].approvalEvidence,
    id: syntheticTemplates[1].id,
    kind: "Message",
    name: syntheticTemplates[1].name,
    version: syntheticTemplates[1].version,
    lifecycle: "Pending",
    approval: syntheticTemplates[1].approvalState,
    detail: `${syntheticTemplates[1].variant} · unavailable for activation`,
  },
] as const;

// The routed governed record. `/templates/[pathwayId]` accepts only this id
// (its `generateStaticParams` emits it and every other id 404s), so it is the one
// record whose detail view has a URL of its own.
const ROUTED_LIBRARY_RECORD_ID = "SYN-PATHWAY-001";

export function TemplatesProductPage({ onOpenOverlay }: { onOpenOverlay?: (overlayId: string) => void }) {
  const pathname = usePathname();
  // Honour the route when the detail URL is open. Without this the pathway id in
  // `/templates/SYN-PATHWAY-001` was decorative: the page rendered the library
  // with its own local selection regardless of which record the URL named.
  const routedRecordId = pathname?.startsWith(`${CARING_CONTACT_MOCKUP_ROUTES.templates}/`)
    ? pathname.slice(`${CARING_CONTACT_MOCKUP_ROUTES.templates}/`.length).split("/")[0]
    : null;
  // The route seeds the selection rather than winning every render: the detail URL
  // opens on the record it names, and the library buttons still work from there.
  // Preferring the route on each render left those buttons reporting aria-pressed
  // while ignoring the click.
  const [selectedRecordId, setSelectedRecordId] = useState(
    () => governedLibraryRecords.find(({ id }) => id === routedRecordId)?.id ?? governedLibraryRecords[0].id,
  );
  const selectedRecord = governedLibraryRecords.find(({ id }) => id === selectedRecordId) ?? governedLibraryRecords[0];
  const selectedIsCurrent = selectedRecord.lifecycle === "Current" && selectedRecord.approval === "Locally approved";
  const approvalDate =
    selectedRecord.lifecycle === "Pending"
      ? "Not approved"
      : selectedRecord.lifecycle === "Retired"
        ? "1 Aug 2026"
        : "14 Aug 2026";
  const nextReview =
    selectedRecord.lifecycle === "Pending"
      ? "Not scheduled"
      : selectedRecord.lifecycle === "Retired"
        ? "Retired record"
        : "14 Aug 2027";

  return (
    <div className="grid min-w-0 gap-5 lg:grid-cols-2" data-testid="caring-contact-screen-templates">
      <ProductSection labelledBy="template-library-heading" className="overflow-hidden">
        <SectionHeading
          id="template-library-heading"
          title="Version library"
          description="Current, retired and pending governed records."
          icon={FileText}
          className={productSectionHeadingPad}
        />
        <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
          {governedLibraryRecords.map((record) => {
            const selected = record.id === selectedRecord.id;
            return (
              <button
                key={record.id}
                type="button"
                aria-pressed={selected}
                onClick={() => setSelectedRecordId(record.id)}
                className={cn(
                  "flex min-h-tap w-full items-start gap-3 px-5 py-4 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-0.125rem] focus-visible:outline-[color:var(--focus)]",
                  selected
                    ? "bg-[color:var(--clinical-accent-soft)] shadow-[var(--rule-accent)]"
                    : "hover:bg-[color:var(--surface-subtle)]",
                )}
              >
                <FileCheck2
                  aria-hidden="true"
                  className={cn(
                    "mt-0.5 size-icon-md shrink-0",
                    selected ? "text-[color:var(--clinical-accent)]" : "text-[color:var(--text-muted)]",
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-[color:var(--text-heading)]">{record.name}</span>
                  <span className="mt-1 block text-xs text-[color:var(--text-muted)]">
                    {record.kind} · {record.version} · {record.detail}
                  </span>
                </span>
                <StatusChip
                  tone={
                    record.lifecycle === "Current" ? "success" : record.lifecycle === "Pending" ? "warning" : "neutral"
                  }
                >
                  {record.lifecycle}
                </StatusChip>
              </button>
            );
          })}
        </div>
      </ProductSection>

      <div className="space-y-5">
        <ProductSection labelledBy="template-detail-heading" className="overflow-hidden">
          <SectionHeading
            id="template-detail-heading"
            className={productSectionHeadingPad}
            title={selectedRecord.name}
            description={`${selectedRecord.kind} · ${selectedRecord.version}`}
            action={
              <span className="flex items-center gap-2">
                {selectedRecord.id === ROUTED_LIBRARY_RECORD_ID && !routedRecordId ? (
                  <Link
                    href={`${CARING_CONTACT_MOCKUP_ROUTES.templates}/${selectedRecord.id}`}
                    className="inline-flex min-h-tap items-center rounded-lg px-2 text-xs font-bold text-[color:var(--clinical-accent)] underline decoration-dotted underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
                  >
                    Open governed record
                  </Link>
                ) : null}
                <StatusChip
                  tone={selectedIsCurrent ? "success" : selectedRecord.lifecycle === "Pending" ? "warning" : "neutral"}
                >
                  {selectedRecord.lifecycle}
                </StatusChip>
              </span>
            }
          />
          <dl className="grid gap-px border-t border-[color:var(--border)] bg-[color:var(--border)] sm:grid-cols-2">
            {[
              ["Approval", selectedRecord.approval],
              ["Record type", selectedRecord.kind],
              ["Programme detail", selectedRecord.detail],
              ["Approved", approvalDate],
              ["Next review", nextReview],
              ["Clinical programme lead", reviewerLine(selectedRecord.approvalEvidence?.clinicalProgrammeLead)],
              [
                "Lived-experience reviewer",
                reviewerLine(selectedRecord.approvalEvidence?.livedExperienceContentReviewer),
              ],
            ].map(([term, value], index) => (
              <div key={term} className={cn("bg-[color:var(--surface)] px-5 py-4", index === 6 && "sm:col-span-2")}>
                <dt className="text-xs text-[color:var(--text-muted)]">{term}</dt>
                <dd className="mt-1 font-semibold text-[color:var(--text-heading)]">{value}</dd>
              </div>
            ))}
          </dl>
        </ProductSection>
        {selectedIsCurrent ? (
          <MessagePreviewCard onPreview={onOpenOverlay ? () => onOpenOverlay("message-preview") : undefined} />
        ) : (
          <div className="flex items-start gap-3 rounded-[var(--radius-xl)] border border-[color:var(--warning-border)] bg-[color:var(--warning-soft)] p-5">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-icon-md shrink-0 text-[color:var(--warning-text)]"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[color:var(--text-heading)]">Unavailable for new activation</p>
              <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
                Retired and pending records remain visible for governance and history, but cannot be selected for a new
                plan.
              </p>
              {onOpenOverlay ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-3"
                  onClick={() => onOpenOverlay("template-changed-retired")}
                >
                  Review lifecycle decision
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function TeamProductPage({ onOpenOverlay }: { onOpenOverlay?: (overlayId: string) => void }) {
  return (
    <div data-testid="caring-contact-screen-team">
      <ProductSection labelledBy="team-ownership-heading" className="overflow-hidden">
        <SectionHeading
          id="team-ownership-heading"
          className={productSectionHeadingPad}
          title="Team ownership"
          description="Explicit coordination, capacity and escalation."
          icon={Users}
          stackActionOnCompact
          action={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <StatusChip tone="warning">12 unclaimed</StatusChip>
              {onOpenOverlay ? (
                <Button variant="secondary" size="sm" onClick={() => onOpenOverlay("reassignment")}>
                  Reassign work
                </Button>
              ) : null}
            </div>
          }
        />
        <div
          className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] xl:hidden"
          data-testid="team-mobile-roster"
        >
          {syntheticTeamMembers.map((member, index) => (
            <article key={member.id} className="space-y-4 px-5 py-5">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <PersonAvatar
                    initials={member.displayName
                      .split(" ")
                      .map((part) => part[0])
                      .join("")}
                    size="sm"
                  />
                  <div className="min-w-0">
                    <h3 className="font-semibold text-[color:var(--text-heading)]">{member.displayName}</h3>
                    <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{member.id}</p>
                  </div>
                </div>
                <Chip appearance={{ kind: "information", tone: "accent" }}>{member.role}</Chip>
              </div>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-[var(--radius-sm)] bg-[color:var(--surface-subtle)] px-3 py-2.5">
                  <dt className="text-xs text-[color:var(--text-muted)]">Active plans</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-[color:var(--text-heading)]">
                    {[8, 18, 7][index]}
                  </dd>
                </div>
                <div className="rounded-[var(--radius-sm)] bg-[color:var(--surface-subtle)] px-3 py-2.5">
                  <dt className="text-xs text-[color:var(--text-muted)]">Unclaimed work</dt>
                  <dd className="mt-1 font-semibold tabular-nums text-[color:var(--text-heading)]">
                    {[2, 4, 1][index]}
                  </dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-[color:var(--text-muted)]">Escalation</dt>
                  <dd className="mt-1 text-[color:var(--text)]">No escalation</dd>
                </div>
              </dl>
            </article>
          ))}
          <article className="space-y-3 bg-[color:var(--warning-soft)] px-5 py-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold text-[color:var(--text-heading)]">Unclaimed work</h3>
              <span className="font-semibold tabular-nums text-[color:var(--warning-text)]">12</span>
            </div>
            <p className="text-sm text-[color:var(--text-muted)]">No owner · escalates after 60 minutes</p>
          </article>
        </div>
        {/*
          Same correction as the continuity strip: the table is `min-w-[42rem]` (672px) against
          roughly 592px of content column at `md:`, so it scrolled horizontally from the moment it
          replaced the card roster that did fit. `xl:` is the first named breakpoint with room for
          it.
        */}
        <div
          className="hidden overflow-x-auto border-t border-[color:var(--border)] polished-scroll xl:block"
          data-testid="team-desktop-table"
        >
          <table className="w-full min-w-[42rem] border-collapse text-left text-sm">
            <thead className="bg-[color:var(--surface-subtle)] text-xs text-[color:var(--text-muted)]">
              <tr>
                <th className="px-5 py-3 font-semibold">Team member</th>
                <th className="px-5 py-3 font-semibold">Role</th>
                <th className="px-5 py-3 font-semibold">Active plans</th>
                <th className="px-5 py-3 font-semibold">Unclaimed work</th>
                <th className="px-5 py-3 font-semibold">Escalation</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[color:var(--border)]">
              {syntheticTeamMembers.map((member, index) => (
                <tr key={member.id}>
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <PersonAvatar
                        initials={member.displayName
                          .split(" ")
                          .map((part) => part[0])
                          .join("")}
                        size="sm"
                      />
                      <div>
                        <p className="font-semibold text-[color:var(--text-heading)]">{member.displayName}</p>
                        <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{member.id}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <Chip appearance={{ kind: "information", tone: "accent" }}>{member.role}</Chip>
                  </td>
                  <td className="px-5 py-4 tabular-nums">{[8, 18, 7][index]}</td>
                  <td className="px-5 py-4 tabular-nums">{[2, 4, 1][index]}</td>
                  <td className="px-5 py-4 text-[color:var(--text-muted)]">No escalation</td>
                </tr>
              ))}
              <tr className="bg-[color:var(--warning-soft)]">
                <td className="px-5 py-4 font-semibold text-[color:var(--text-heading)]">Unclaimed work</td>
                <td className="px-5 py-4 text-[color:var(--text-muted)]">No owner</td>
                <td className="px-5 py-4">Not applicable</td>
                <td className="px-5 py-4 font-semibold tabular-nums">12</td>
                <td className="px-5 py-4 text-[color:var(--warning-text)]">Escalates after 60 minutes</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="border-t border-[color:var(--border)] px-5 py-3 text-xs text-[color:var(--text-muted)]">
          External alerts contain no patient information.
        </p>
      </ProductSection>
    </div>
  );
}

export function GuidanceProductPage() {
  return (
    <div className="grid gap-5 lg:grid-cols-2" data-testid="caring-contact-screen-guidance">
      <div className="space-y-5">
        <OneWayBoundary />
        <ProductSection labelledBy="guidance-incident-heading" className="overflow-hidden">
          <SectionHeading
            id="guidance-incident-heading"
            title="Incident and downtime"
            description="Conservative operational behaviour when systems are unavailable."
            icon={ShieldCheck}
            className={productSectionHeadingPad}
          />
          <ul className="space-y-3 border-t border-[color:var(--border)] px-5 py-5 text-sm leading-6 text-[color:var(--text-muted)] sm:px-6">
            {[
              "Pause sending when a system incident is declared.",
              "Do not queue messages beyond the next approved send.",
              "Record the incident and notify the owning team.",
              "Resume the original schedule only after restoration is confirmed.",
              "Do not automatically resend a contact missed during downtime.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <CheckCircle2
                  aria-hidden="true"
                  className="mt-1 size-icon-sm shrink-0 text-[color:var(--clinical-accent)]"
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </ProductSection>
      </div>
      <aside className="space-y-5">
        <ProductSection labelledBy="guidance-language-heading" className="overflow-hidden">
          <SectionHeading id="guidance-language-heading" title="Language rules" icon={MessageSquareText} compact />
          <dl className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)] px-4 text-sm">
            {[
              ["Use", "Agreement"],
              ["Never imply", "Consent, monitoring or crisis response"],
              ["Delivered means", "Transport receipt only"],
              ["Times", "Always show AWST"],
              ["Actions", "Verb-first and object-specific"],
            ].map(([term, value]) => (
              <div key={term} className="py-3">
                <dt className="text-xs font-medium text-[color:var(--text-muted)]">{term}</dt>
                <dd className="mt-1 font-medium text-[color:var(--text)]">{value}</dd>
              </div>
            ))}
          </dl>
        </ProductSection>
        <ProductSection labelledBy="guidance-support-heading" className="overflow-hidden">
          <SectionHeading id="guidance-support-heading" title="Need help?" icon={CircleHelp} compact />
          <div className="border-t border-[color:var(--border)] p-4">
            <p className="text-sm leading-6 text-[color:var(--text-muted)]">
              Escalate programme, clinical-language or operational uncertainty to the team lead. Do not infer a patient
              state from transport data.
            </p>
          </div>
        </ProductSection>
      </aside>
    </div>
  );
}

export function ReportsProductPage() {
  return (
    <div className="space-y-5" data-testid="caring-contact-screen-reports">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Due", "14", "Today"],
          ["Dispatched", "13", "Today"],
          ["Named failures", "1", "Operational review"],
          ["Median resolution", "38 min", "Last 7 days"],
        ].map(([label, value, note]) => (
          <div key={label} className={cn(productSurface, "px-5 py-4")}>
            <p className="text-sm font-medium text-[color:var(--text-muted)]">{label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-[color:var(--text-heading)]">{value}</p>
            <p className="mt-1 text-xs text-[color:var(--text-muted)]">{note}</p>
          </div>
        ))}
      </div>

      <ProductSection labelledBy="operational-reporting-heading" className="overflow-hidden">
        <SectionHeading
          id="operational-reporting-heading"
          title="Operational reporting"
          description="Aggregate service measures only. No clinical outcome, response or engagement inference."
          icon={ListChecks}
          className={productSectionHeadingPad}
        />
        <div className="divide-y divide-[color:var(--border)] border-t border-[color:var(--border)]">
          {[
            ["Due and dispatched", "14 due · 13 dispatched", "One contact remains in a named operational state"],
            ["Permanent transport failures", "1 named exception", "No automated clinical action"],
            ["Resolution time", "Median 38 minutes", "From named exception to recorded outcome"],
            ["Approved demographic cell", "Suppressed", "Below the minimum reporting threshold"],
          ].map(([title, value, note]) => (
            <div key={title} className="grid w-full gap-2 px-5 py-4 sm:grid-cols-3 sm:items-center sm:px-6">
              <span className="font-semibold text-[color:var(--text-heading)]">{title}</span>
              <span className="text-sm font-medium text-[color:var(--text)]">{value}</span>
              <span className="text-sm text-[color:var(--text-muted)]">{note}</span>
            </div>
          ))}
        </div>
      </ProductSection>

      <div className="flex items-start gap-3 border-t border-[color:var(--border)] pt-5 text-sm text-[color:var(--text-muted)]">
        <Info aria-hidden="true" className="mt-0.5 size-icon-md shrink-0" />
        <p>All measures exclude unclaimed work and contain no patient-identifying information.</p>
      </div>
    </div>
  );
}
