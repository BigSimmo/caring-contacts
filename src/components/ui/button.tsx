"use client";

import { Loader2, type LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { cn, controlBase } from "@/components/ui-primitives";

export type ButtonVariant = "primary" | "secondary" | "toolbar" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

// One filled `--command` button per surface (register #12). `secondary` is the
// default for everything that is not the single primary action on screen.
//
// `danger` is the ONLY home for `--danger-solid` (register #13): a destructive
// action is the one place a filled red is not decoration. Do not reach for it to
// mean "important" — importance is `primary`.
const VARIANT: Record<ButtonVariant, string> = {
  primary:
    "bg-[color:var(--command)] text-[color:var(--command-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--command-hover)] hover:shadow-[var(--shadow-hover)] active:bg-[color:var(--command-active)]",
  secondary:
    "border border-[color:var(--border-lux)] bg-[color:var(--surface-raised)] text-[color:var(--text)] shadow-[var(--shadow-inset)] hover:border-[color:var(--border-strong)] hover:bg-[color:var(--surface-subtle)]",
  toolbar:
    "border border-[color:var(--border)] bg-[color:var(--surface)] text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
  ghost:
    "bg-transparent text-[color:var(--text-muted)] hover:bg-[color:var(--surface-subtle)] hover:text-[color:var(--text)]",
  danger:
    "bg-[color:var(--danger-solid)] text-[color:var(--danger-solid-contrast)] shadow-[var(--e1)] hover:bg-[color:var(--danger-solid-hover)] active:bg-[color:var(--danger-solid-active)]",
};

// Height is the tap target and never drops below `--spacing-tap` (48px); `size` moves the optical
// padding and label step, not the hit area (register #7/#18).
const SIZE: Record<ButtonSize, string> = {
  sm: "px-3 text-xs",
  md: "px-4 text-sm",
  lg: "px-5 text-sm",
};

/**
 * The Button face as a class string, for a control that has to be an anchor
 * rather than a `<button>`.
 *
 * The case this exists for: a result row whose whole surface navigates needs a
 * real `<a>`, so that a tap, a cmd-click, a middle-click and a long-press all
 * behave the way the browser already knows how to make them behave — none of
 * which a `router.push` in an `onClick` can offer. `Button` always renders a
 * `<button>` and has no polymorphic escape, so the caller builds the anchor and
 * borrows the face from here rather than copying the variant strings, which
 * would then drift the next time a variant changes.
 */
export function buttonFaceClass({
  variant = "secondary",
  size = "md",
  block = false,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
} = {}) {
  return cn(controlBase, VARIANT[variant], SIZE[size], block && "w-full");
}

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
  /** Leading icon, rendered decoratively. Swapped for the spinner while busy. */
  icon?: LucideIcon;
  /** Trailing icon; hidden while busy so the row cannot show two glyphs. */
  trailingIcon?: LucideIcon;
  /** Stretch to the container width — for phone dialogs and stacked forms. */
  block?: boolean;
  /**
   * Busy state, folded in from AsyncButton: disables the control, announces via
   * `aria-busy`, swaps the leading glyph for a spinner and the label for
   * `busyLabel`. A busy button with no `busyLabel` keeps its idle label.
   */
  busy?: boolean;
  busyLabel?: string;
  /**
   * Forwarded to the underlying `<button>`. Declared explicitly rather than left
   * to `...props`: React 19 passes `ref` as an ordinary prop for function
   * components, but `ButtonHTMLAttributes` does not carry it, so without this
   * line every caller needing the node — anchoring a popover, driving focus
   * after a destructive confirm, measuring for a tooltip — could not reach it,
   * and TypeScript rejected the attempt rather than failing silently.
   */
  ref?: Ref<HTMLButtonElement>;
  /**
   * Rendered as `data-testid`. A bare `data-testid` cannot be passed to a
   * component: `@types/react@19` gives `HTMLAttributes` no `data-${string}`
   * index signature, and TypeScript only waives unknown `data-*` attributes on
   * intrinsic elements. Same `testId` spelling `Sheet` and the dashboard shells
   * already use.
   */
  testId?: string;
};

export function Button({
  variant = "secondary",
  size = "md",
  children,
  icon: Icon,
  trailingIcon: TrailingIcon,
  block = false,
  busy = false,
  busyLabel,
  className,
  disabled,
  type,
  ref,
  testId,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      data-testid={testId}
      type={type ?? "button"}
      disabled={busy || disabled}
      aria-busy={busy || undefined}
      className={cn(controlBase, VARIANT[variant], SIZE[size], block && "w-full", className)}
    >
      {busy ? (
        <Loader2 aria-hidden="true" className="size-icon-md shrink-0 animate-spin motion-reduce:animate-none" />
      ) : Icon ? (
        <Icon aria-hidden="true" className="size-icon-md shrink-0" />
      ) : null}
      <span>{busy && busyLabel ? busyLabel : children}</span>
      {!busy && TrailingIcon ? <TrailingIcon aria-hidden="true" className="size-icon-md shrink-0" /> : null}
    </button>
  );
}
