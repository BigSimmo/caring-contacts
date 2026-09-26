import { Check, CheckCircle2, Info, LockKeyhole, MessageSquareText, ShieldCheck, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Chip, type ChipStatusTone } from "@/components/ui/chip";
import { cn } from "@/components/ui-primitives";

import { ROWAN_SELECTED_SENDING_PREFERENCE, syntheticPatients, syntheticPlannedContacts } from "./fixtures";
import {
  EXACT_MESSAGE_GSM7,
  EXACT_PATIENT_VISIBLE_MESSAGE,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "./personalisation-screen";

export const productSurface =
  "min-w-0 rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface-raised)]";

export const productInset =
  "min-w-0 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)]";

export function ProductSection({
  children,
  className,
  labelledBy,
}: {
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className={cn(productSurface, className)}>
      {children}
    </section>
  );
}

export { SectionHeading, type SectionHeadingProps } from "@/components/ui/section-heading";

/**
 * The inset a card's own header needs, because neither of the two components involved supplies one.
 *
 * `ProductSection` above renders `cn(productSurface, className)` with no padding — deliberately, so
 * a section can hold a full-bleed table or a divider that reaches the card edge. The shared
 * `SectionHeading`'s DEFAULT branch has none either; only its `compact` variant carries `px-4 py-3`.
 * Put the two together, as every screen here does, and the heading sits 1px from the card border
 * while the body beneath it is inset 25px. Measured at 1280px on the Today screen before this
 * constant existed: heading left offset 1px, body left offset 25px, on both of the first two cards
 * a reader sees. Headings with an `icon` only LOOKED padded — the icon tile filled the space, and
 * the icon itself was at 1px too.
 *
 * `px-5 py-5 sm:px-6` matches the body inset this file already uses (`px-5 py-5 sm:px-6`), so the
 * heading and the content under it now share one left edge at every width.
 *
 * `SectionHeading` is shared with 40-odd other files app-wide, so the fix belongs here at the
 * prototype's call sites rather than in that component: giving the default branch padding would
 * move every other consumer of it in the app.
 */
export const productSectionHeadingPad = "px-5 py-5 sm:px-6";

export function PersonAvatar({ initials, size = "md" }: { initials: string; size?: "sm" | "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] font-semibold text-[color:var(--clinical-accent)] forced-colors:border forced-colors:border-[CanvasText]",
        size === "sm" && "size-8 text-xs",
        size === "md" && "size-10 text-sm",
        size === "lg" && "size-12 text-base",
      )}
    >
      {initials}
    </span>
  );
}

/**
 * A status pill hugs its label, including inside a grid cell.
 *
 * `Chip` is `inline-flex`, which is enough everywhere except a CSS grid: a grid item's default
 * `justify-self` is `stretch`, so the pill silently grew to the width of its column. Three rows
 * here stack into a single-column grid below `sm` and one of them is a four-column grid at every
 * width, so the effect was a 316px-wide "Delivered" holding 67px of text on the phone Today
 * screen, and a 262px "Requires action" on the desktop Schedule screen — a pill that reads as an
 * empty input rather than a label. Measured before this line existed, on the built production app.
 *
 * `justify-self` has no meaning outside a grid, so this changes nothing in the flex rows the same
 * chip appears in, and it fixes the call sites that do not exist yet as well as the three that do.
 */
export function StatusChip({ children, tone }: { children: ReactNode; tone: ChipStatusTone }) {
  return (
    <Chip appearance={{ kind: "status", tone }} className="justify-self-start" dot>
      {children}
    </Chip>
  );
}

export function PatientIdentityStrip({ compact = false }: { compact?: boolean }) {
  const patient = syntheticPatients[1];
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-3 border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] forced-colors:border-[CanvasText]",
        compact ? "rounded-[var(--radius-lg)] px-4 py-3" : "rounded-[var(--radius-xl)] px-4 py-4 sm:px-5",
      )}
    >
      <PersonAvatar initials="RS" size={compact ? "sm" : "md"} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-[color:var(--text-heading)]">{patient.fullName}</p>
        <p className="mt-0.5 truncate text-xs text-[color:var(--text-muted)] sm:text-sm">
          DOB 3 Nov 1987 <span aria-hidden="true">·</span> {patient.id}
        </p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[color:var(--clinical-accent)]">
        <CheckCircle2 aria-hidden="true" className="size-icon-sm" />
        Identity matched
      </span>
    </div>
  );
}

const workflowSteps = ["Patient and agreement", "Pathway", "Personalisation", "Review"] as const;

export function WorkflowStepper({ activeStep }: { activeStep: 1 | 2 | 3 | 4 }) {
  return (
    <nav aria-label="Plan activation progress" className="min-w-0">
      <ol className="flex items-center rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2">
        {workflowSteps.map((step, index) => {
          const number = (index + 1) as 1 | 2 | 3 | 4;
          const complete = number < activeStep;
          const current = number === activeStep;
          return (
            <li key={step} className="flex min-w-0 flex-1 items-center" aria-current={current ? "step" : undefined}>
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold forced-colors:border-[CanvasText]",
                    complete &&
                      "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent)] text-[color:var(--clinical-accent-contrast)]",
                    current &&
                      "border-[color:var(--clinical-accent)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
                    !complete &&
                      !current &&
                      "border-[color:var(--border-strong)] bg-[color:var(--surface)] text-[color:var(--text-muted)]",
                  )}
                >
                  {complete ? <Check aria-hidden="true" className="size-icon-sm" /> : number}
                </span>
                <span
                  className={cn(
                    "sr-only truncate text-xs font-medium sm:not-sr-only",
                    current ? "text-[color:var(--text)]" : "text-[color:var(--text-muted)]",
                  )}
                >
                  {step}
                </span>
              </div>
              {index < workflowSteps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "mx-2 h-px min-w-3 flex-1 sm:mx-3 sm:min-w-4",
                    complete ? "bg-[color:var(--clinical-accent)]" : "bg-[color:var(--border)]",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function AssuranceRow({
  icon: Icon,
  label,
  value,
  source,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="grid min-w-0 gap-3 border-t border-[color:var(--border)] px-4 py-4 first:border-t-0 sm:flex sm:items-center sm:px-5">
      <span className="grid size-9 place-items-center rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] text-[color:var(--clinical-accent)] forced-colors:border forced-colors:border-[CanvasText]">
        <Icon aria-hidden="true" className="size-icon-md" />
      </span>
      <div className="min-w-0 sm:w-40 sm:shrink-0">
        <p className="font-semibold text-[color:var(--text-heading)]">{label}</p>
        <p className="mt-0.5 text-xs text-[color:var(--text-muted)] sm:hidden">{source}</p>
      </div>
      <div className="min-w-0 sm:flex-1">
        <p className="text-sm font-medium text-[color:var(--text)]">{value}</p>
        <p className="mt-0.5 hidden text-xs text-[color:var(--text-muted)] sm:block">Source: {source}</p>
      </div>
      <CheckCircle2
        aria-label="Assurance present"
        className="size-icon-md text-[color:var(--success)] forced-colors:text-[CanvasText]"
      />
    </div>
  );
}

export function MessagePreviewCard({ compact = false, onPreview }: { compact?: boolean; onPreview?: () => void }) {
  return (
    <div className={cn(productSurface, "overflow-hidden", compact && "rounded-[var(--radius-lg)]")}>
      <div className="flex items-start gap-3 border-b border-[color:var(--border)] px-4 py-3 sm:px-5">
        <MessageSquareText
          aria-hidden="true"
          className="mt-0.5 size-icon-md shrink-0 text-[color:var(--clinical-accent)]"
        />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[color:var(--text-heading)]">Exact patient-visible message</p>
          <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">Warm neutral A · governed version</p>
        </div>
        <Chip appearance={{ kind: "information", tone: "accent" }}>{EXACT_MESSAGE_GSM7.segments} segments</Chip>
      </div>
      <blockquote className="m-4 rounded-[var(--radius-lg)] bg-[color:var(--surface-inset)] p-4 text-sm leading-6 text-[color:var(--text)] shadow-[var(--shadow-well)] sm:m-5">
        {EXACT_PATIENT_VISIBLE_MESSAGE}
      </blockquote>
      <div className="flex flex-col gap-3 border-t border-[color:var(--border)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="flex items-start gap-2 text-xs leading-5 text-[color:var(--text-muted)]">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-icon-sm shrink-0" />
          GSM-7 · {EXACT_MESSAGE_GSM7.septets} septets · non-receiving sender · maximum two segments
        </div>
        {onPreview ? (
          <Button variant="secondary" size="sm" onClick={onPreview}>
            Open message preview
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function OneWayBoundary({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "border border-[color:var(--info-border)] bg-[color:var(--info-soft)]",
        compact ? "rounded-[var(--radius-lg)] p-3" : "rounded-[var(--radius-xl)] p-4 sm:p-5",
      )}
    >
      <div className="flex items-start gap-3">
        <Info
          aria-hidden="true"
          className="mt-0.5 size-icon-md shrink-0 text-[color:var(--info-text)] forced-colors:text-[CanvasText]"
        />
        <div className="min-w-0">
          <p className="font-semibold text-[color:var(--text-heading)]">One-way programme boundary</p>
          <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
            Caring contacts supplement usual care. {PATIENT_VISIBLE_NO_REPLY_NOTICE}. Delivered is a transport receipt
            only and never means the message was read or the patient is safe.
          </p>
        </div>
      </div>
    </div>
  );
}

const dateFormatter = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Australia/Perth",
});

export function ScheduleList({ limit }: { limit?: number }) {
  const contacts = limit === undefined ? syntheticPlannedContacts : syntheticPlannedContacts.slice(0, limit);
  return (
    <ol aria-label="Caring-contact schedule" className="divide-y divide-[color:var(--border)]">
      {contacts.map((contact) => (
        <li
          key={contact.id}
          className="grid min-w-0 grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-4 py-3 sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] sm:items-start sm:px-5"
        >
          <span className="grid size-7 place-items-center rounded-full border border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-xs font-semibold text-[color:var(--clinical-accent)] forced-colors:border-[CanvasText]">
            {contact.sequence}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-[color:var(--text-heading)]">{contact.cadenceLabel}</span>
              <time dateTime={contact.scheduledAt} className="text-sm tabular-nums text-[color:var(--text)]">
                {dateFormatter.format(new Date(contact.scheduledAt))}
              </time>
            </div>
            <span className="mt-0.5 block text-sm text-[color:var(--text-muted)]">
              {ROWAN_SELECTED_SENDING_PREFERENCE.windowLabel}
            </span>
          </div>
          <div className="col-start-2 sm:col-start-3 sm:row-start-1">
            <StatusChip tone={contact.transportState === "Delivered" ? "success" : "neutral"}>
              {contact.transportState}
            </StatusChip>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function VerifiedSummary({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[color:var(--success-border)] bg-[color:var(--success-soft)] p-4">
      <ShieldCheck
        aria-hidden="true"
        className="mt-0.5 size-icon-md shrink-0 text-[color:var(--success-text)] forced-colors:text-[CanvasText]"
      />
      <div className="min-w-0 text-sm leading-5 text-[color:var(--text-muted)]">{children}</div>
    </div>
  );
}
