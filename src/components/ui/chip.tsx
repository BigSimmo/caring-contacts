"use client";

import { X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  cn,
  ignoreUnavailableActivation,
  toneDanger,
  toneInfo,
  toneNeutral,
  toneSuccess,
  toneWarning,
} from "@/components/ui-primitives";

export type ChipSize = "compact" | "standard";
export type ChipStatusTone = "neutral" | "info" | "success" | "warning" | "danger";
export type ChipCategoryTone =
  "document" | "table" | "search" | "source" | "service" | "form" | "purple" | "indigo" | "rose" | "slate";
export type ChipInformationTone = "neutral" | "quiet" | "inset" | "accent" | "info";

export type ChipAppearance =
  | { kind: "status"; tone: ChipStatusTone }
  | { kind: "category"; tone: ChipCategoryTone }
  | { kind: "information"; tone?: ChipInformationTone };

const STATUS: Record<ChipStatusTone, string> = {
  neutral: toneNeutral,
  info: toneInfo,
  success: toneSuccess,
  warning: toneWarning,
  danger: toneDanger,
};

const CATEGORY: Record<ChipCategoryTone, string> = {
  document:
    "border-[color:var(--type-document-border)] bg-[color:var(--type-document-soft)] text-[color:var(--type-document)]",
  table: "border-[color:var(--type-table-border)] bg-[color:var(--type-table-soft)] text-[color:var(--type-table)]",
  search: "border-[color:var(--type-search-border)] bg-[color:var(--type-search-soft)] text-[color:var(--type-search)]",
  source: "border-[color:var(--type-source-border)] bg-[color:var(--type-source-soft)] text-[color:var(--type-source)]",
  service:
    "border-[color:var(--type-service-border)] bg-[color:var(--type-service-soft)] text-[color:var(--type-service)]",
  form: "border-[color:var(--type-form-border)] bg-[color:var(--type-form-soft)] text-[color:var(--type-form)]",
  purple: "border-[color:var(--tone-purple-border)] bg-[color:var(--tone-purple-soft)] text-[color:var(--tone-purple)]",
  indigo: "border-[color:var(--tone-indigo-border)] bg-[color:var(--tone-indigo-soft)] text-[color:var(--tone-indigo)]",
  rose: "border-[color:var(--tone-rose-border)] bg-[color:var(--tone-rose-soft)] text-[color:var(--tone-rose)]",
  slate: "border-[color:var(--tone-slate-border)] bg-[color:var(--tone-slate-soft)] text-[color:var(--tone-slate)]",
};

const INFORMATION: Record<ChipInformationTone, string> = {
  neutral: toneNeutral,
  quiet: "border-transparent bg-[color:var(--surface-subtle)] text-[color:var(--text-muted)]",
  inset: "border-[color:var(--border)] bg-[color:var(--surface-inset)] text-[color:var(--text-muted)]",
  accent:
    "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)] text-[color:var(--clinical-accent)]",
  info: toneInfo,
};

const SIZE: Record<ChipSize, string> = {
  compact: "h-6 px-2 text-2xs",
  standard: "h-7 px-2.5 text-xs",
};

/** Multi-line clinical tags: keep the same density floor, allow the label to wrap. */
const SIZE_WRAP: Record<ChipSize, string> = {
  compact: "min-h-6 px-2 py-1 text-2xs leading-snug",
  standard: "min-h-7 px-2.5 py-1 text-xs leading-snug",
};

function appearanceClasses(appearance: ChipAppearance) {
  if (appearance.kind === "status") return STATUS[appearance.tone];
  if (appearance.kind === "category") return CATEGORY[appearance.tone];
  return INFORMATION[appearance.tone ?? "neutral"];
}

export type ChoiceChipProps = {
  children: ReactNode;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  size?: ChipSize;
  icon?: LucideIcon;
  /** Optional category/status treatment for specialised tag families. */
  appearance?: ChipAppearance;
  disabled?: boolean;
  ariaDisabled?: boolean;
  ariaLabel?: string;
  ariaDescribedBy?: string;
  title?: string;
  testId?: string;
  /** Layout only: width, shrink/grow, alignment and wrapping. */
  className?: string;
};

/** Compact many-of-many selection. Use SegmentedControl for one-of-many choices. */
export function ChoiceChip({
  children,
  pressed,
  onPressedChange,
  size = "standard",
  icon: Icon,
  appearance,
  className,
  disabled,
  ariaDisabled,
  ariaLabel,
  ariaDescribedBy,
  title,
  testId,
}: ChoiceChipProps) {
  // An explained dead end remains focusable. If both flags arrive, preserve that
  // accessible state rather than allowing native disabled to remove it from Tab.
  const ariaUnavailable = Boolean(ariaDisabled);
  const nativeDisabled = Boolean(disabled) && !ariaUnavailable;
  const unavailable = nativeDisabled || ariaUnavailable;
  const unavailableAttributes = ariaUnavailable
    ? { "aria-disabled": true, disabled: false }
    : { disabled: nativeDisabled };
  const surfaceAppearance = unavailable
    ? "border-dashed border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]"
    : appearance
      ? appearanceClasses(appearance)
      : pressed
        ? "border-[color:var(--clinical-accent-border)] bg-[color:var(--clinical-accent-soft)]"
        : "border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] group-hover:border-[color:var(--border-strong)] group-hover:bg-[color:var(--surface-subtle)]";
  const contentAppearance = unavailable
    ? "cursor-default text-[color:var(--text-muted)]"
    : appearance
      ? cn(appearanceClasses(appearance), "!border-transparent !bg-transparent")
      : pressed
        ? "text-[color:var(--clinical-accent)]"
        : "text-[color:var(--text-muted)] hover:text-[color:var(--text)]";

  return (
    <button
      type="button"
      {...unavailableAttributes}
      aria-pressed={pressed}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      title={title}
      data-testid={testId}
      data-choice-chip="true"
      data-size={size}
      onClick={(event) => {
        if (unavailable) {
          if (ariaUnavailable) ignoreUnavailableActivation(event);
          return;
        }
        onPressedChange(!pressed);
      }}
      className={cn(
        "group relative isolate inline-flex min-h-tap max-w-full items-center justify-center rounded-lg font-semibold leading-none transition motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]",
        size === "compact" ? "px-2.5 text-2xs" : "px-3 text-xs",
        contentAppearance,
        pressed && "font-bold forced-colors:outline forced-colors:outline-2 forced-colors:[outline-color:Highlight]",
        className,
      )}
    >
      <span
        aria-hidden="true"
        data-choice-chip-surface="true"
        className={cn(
          "pointer-events-none absolute inset-1 z-0 rounded-lg border shadow-[var(--shadow-inset)]",
          surfaceAppearance,
        )}
      />
      <span
        data-choice-chip-content="true"
        className="relative z-[var(--z-raised)] inline-flex min-w-0 items-center justify-center gap-1.5"
      >
        {Icon ? <Icon aria-hidden="true" className="size-icon-xs shrink-0" /> : null}
        {typeof children === "string" ? <span className="min-w-0 truncate">{children}</span> : children}
      </span>
    </button>
  );
}

function dotClasses(appearance: ChipAppearance) {
  if (appearance.kind === "status") {
    if (appearance.tone === "success") return "bg-[color:var(--success)]";
    if (appearance.tone === "warning") return "bg-[color:var(--warning)]";
    if (appearance.tone === "danger") return "bg-[color:var(--danger)]";
    if (appearance.tone === "info") return "bg-[color:var(--info)]";
  }
  return "bg-current";
}

type ChipBase = {
  children: ReactNode;
  size?: ChipSize;
  appearance?: ChipAppearance;
  /** Status dot. Never the only carrier of meaning — the label still says it. */
  dot?: boolean;
  icon?: LucideIcon;
  /**
   * Allow the label to wrap onto extra lines. Default density stays single-line
   * and fixed-height; opt in for arbitrary clinical tag phrases.
   */
  wrap?: boolean;
  /** Native title when children are not a plain string (truncated/wrap hover text). */
  title?: string;
  /** Layout only: margin, width, shrink/grow, alignment and wrapping. */
  className?: string;
};

/** Removable chips require a unique, object-specific label. */
export type ChipProps = ChipBase &
  ({ onRemove: () => void; removeLabel: string } | { onRemove?: never; removeLabel?: never });

export function Chip({
  children,
  size = "standard",
  appearance = { kind: "information", tone: "neutral" },
  dot = false,
  icon: Icon,
  wrap = false,
  title,
  onRemove,
  removeLabel,
  className,
}: ChipProps) {
  const fullLabel = title ?? (typeof children === "string" ? children : undefined);
  return (
    <span
      data-testid="chip"
      data-size={size}
      data-appearance={appearance.kind}
      data-wrap={wrap ? "true" : "false"}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md border font-semibold",
        wrap ? `${SIZE_WRAP[size]} whitespace-normal` : `${SIZE[size]} leading-none`,
        appearanceClasses(appearance),
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClasses(appearance))} /> : null}
      {Icon ? <Icon aria-hidden="true" className="size-icon-xs shrink-0" /> : null}
      <span
        className={cn("min-w-0", wrap ? "whitespace-normal break-words" : "max-h-full overflow-hidden truncate")}
        title={fullLabel}
      >
        {children}
      </span>
      {onRemove ? (
        // Visual chip stays compact. The remove control is absolutely centred so
        // its padded hit can be min-h-tap / w-8 without inflating ChoiceChip
        // (already min-h-tap) or the painted Chip. Wrap still stretches the
        // track to the flex line so a multi-line tag does not collapse to 0.
        <span className={cn("relative w-5 shrink-0", wrap ? "min-h-5 self-stretch" : "h-full self-center")}>
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            // w-8 overhangs the w-5 track into chip padding. min-h-tap is the
            // production floor; do not add max-w-full - that clamps the enlarge.
            className="absolute left-1/2 top-1/2 grid min-h-tap w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[color:var(--focus)]"
          >
            <span className="grid h-5 w-5 place-items-center rounded-sm transition hover:bg-[color:var(--surface-highlight)]">
              <X aria-hidden="true" className="h-3 w-3" />
            </span>
          </button>
        </span>
      ) : null}
    </span>
  );
}
