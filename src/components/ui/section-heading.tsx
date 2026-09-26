import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn, eyebrowText, textMuted } from "@/components/ui-primitives";

export type SectionHeadingProps = {
  id?: string;
  title?: string;
  children?: ReactNode;
  /** Short kicker above the title (e.g. in record sections). */
  eyebrow?: string;
  /** Supporting copy. `body` and `description` are interchangeable aliases. */
  body?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Mobile compact sizing / responsiveness */
  hideDescriptionOnMobile?: boolean;
  compactMobile?: boolean;
  compact?: boolean;
  stackActionOnCompact?: boolean;
  /** Step number badge (e.g. governance sections) */
  step?: string | number;
  /** Display variant: default, menu-kicker (compact uppercase kicker for menus/drawers) */
  variant?: "default" | "menu-kicker";
};

/**
 * Shared section heading recipe for dashboard modes, record sections, menus, and tool panels.
 *
 * Consolidates local variants into a single component supporting:
 * 1. Eyebrow record headers (formulation, specifiers)
 * 2. Step-badged section headers (dictionary governance)
 * 3. Menu kicker headings (search pins, drawer sub-sections)
 * 4. Icon-badged panel headings with actions (clinical dashboard, caring contacts)
 * 5. Mobile responsiveness (hiding description, compact sizing)
 */
export function SectionHeading({
  id,
  title,
  children,
  eyebrow,
  body,
  description,
  icon: Icon,
  action,
  actions,
  className,
  testId,
  headingLevel = 2,
  hideDescriptionOnMobile = false,
  compactMobile = false,
  compact = false,
  stackActionOnCompact = false,
  step,
  variant = "default",
}: SectionHeadingProps) {
  const headingTitle = title ?? (typeof children === "string" ? children : undefined);
  const content = body ?? description ?? (typeof children !== "string" ? children : undefined);
  const actionSlot = action ?? actions;
  const HeadingTag = `h${headingLevel}` as const;

  // Menu-kicker mode (e.g. in search-pins menu, popovers, drawers)
  if (variant === "menu-kicker") {
    return (
      <div data-testid={testId} className={cn("mb-1 flex min-h-10 items-center justify-between gap-2 px-2", className)}>
        <HeadingTag
          id={id}
          className="text-2xs font-extrabold uppercase tracking-kicker text-[color:var(--text-muted)]"
        >
          {headingTitle}
        </HeadingTag>
        {actionSlot}
      </div>
    );
  }

  // Step-badged mode (e.g. dictionary governance)
  if (step !== undefined) {
    return (
      <div
        data-testid={testId}
        className={cn("flex items-center gap-3 border-b border-[color:var(--border)] pb-3", className)}
      >
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[color:var(--clinical-accent-soft)] text-2xs font-extrabold text-[color:var(--clinical-accent)]">
          {step}
        </span>
        <HeadingTag id={id} className="text-lg font-extrabold text-[color:var(--text-heading)] sm:text-xl">
          {headingTitle}
        </HeadingTag>
        {actionSlot}
      </div>
    );
  }

  // Eyebrow / Record header mode (e.g. formulation, specifiers)
  if (eyebrow && !Icon) {
    return (
      <header data-testid={testId} className={cn("grid gap-1.5", className)}>
        <p className={eyebrowText}>{eyebrow}</p>
        <HeadingTag
          id={id}
          className="text-xl font-extrabold tracking-tight text-[color:var(--text-heading)] sm:text-2xl"
        >
          {headingTitle}
        </HeadingTag>
        {content ? (
          <p className="max-w-3xl text-sm font-medium leading-6 text-[color:var(--text-muted)]">{content}</p>
        ) : null}
      </header>
    );
  }

  // Dashboard / Panel section heading mode with icon or actions
  const alignWhenCompact = compactMobile && hideDescriptionOnMobile ? "items-center sm:items-start" : "items-start";

  return (
    <div
      data-testid={testId}
      className={cn(
        "flex flex-wrap justify-between",
        alignWhenCompact,
        stackActionOnCompact && "flex-col sm:flex-row",
        compact ? "px-4 py-3" : compactMobile ? "gap-2 sm:gap-3" : "gap-3",
        className,
      )}
    >
      <div className={cn("flex min-w-0", alignWhenCompact, compactMobile ? "gap-2 sm:gap-3" : "gap-3")}>
        {Icon ? (
          <span
            data-section-heading-icon
            className={cn(
              "grid shrink-0 place-items-center rounded-lg bg-[color:var(--primary-soft)] text-[color:var(--primary)] forced-colors:border forced-colors:border-[CanvasText]",
              compactMobile ? "h-7 w-7 sm:h-9 sm:w-9" : "h-9 w-9",
            )}
          >
            <Icon aria-hidden="true" className={cn(compactMobile ? "size-icon-md sm:size-icon-lg" : "size-icon-lg")} />
          </span>
        ) : null}
        <div className="min-w-0">
          <HeadingTag
            id={id}
            className={cn(
              "font-semibold text-[color:var(--text-heading)]",
              compactMobile ? "text-base-minus sm:text-base" : "text-base-minus sm:text-base tracking-tight",
            )}
          >
            {headingTitle}
          </HeadingTag>
          {content ? (
            <p className={cn("mt-1 text-sm leading-6", textMuted, hideDescriptionOnMobile && "hidden sm:block")}>
              {content}
            </p>
          ) : null}
        </div>
      </div>
      {actionSlot ? (
        <div className={cn("shrink-0", stackActionOnCompact && "w-full sm:w-auto")}>{actionSlot}</div>
      ) : null}
    </div>
  );
}
