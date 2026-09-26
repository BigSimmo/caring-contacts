import type { ReactNode } from "react";

/**
 * A statement of what is true, why it is true, and what would change it — in one named group.
 *
 * THE SHAPE IS `AutomatedState`'s AND THE COMPONENT DELIBERATELY IS NOT (Ruling 81).
 * `automated-state.tsx` states something the SYSTEM did on its own — paused, suppressed, blocked —
 * and carries a `CircleAlert` icon plus a state-name `aria-label` to match. The activation wizard
 * needs the same three-part statement for things a PERSON did: a pathway chosen by whoever
 * accepted the referral, a referral that has not been accepted yet, a draft kept in this browser.
 * Rendering `AutomatedState` for those would attach an automation's icon and vocabulary to a human
 * decision, which is the exact reuse Ruling 81 refused. So the WORDING SHAPE is reused — a
 * clinician learns "Why: … / What changes it: …" once, across the whole workspace — and the
 * component is its own.
 *
 * The accessible grouping is reused for the reason `list-empty-state.tsx` records: a screen reader
 * that reaches the heading has entered a named group and finds the reason and the remedy without
 * hunting for them. `aria-label={heading}` rather than `aria-labelledby`, the same `useId`-avoiding
 * technique both of those files already prove safe — `aria-labelledby` needs an id, an id needs
 * `useId`, and `useId` is a hook, which would make every server-rendered caller a Client Component.
 *
 * No `"use client"` and no hooks, deliberately: the wizard is a Client Component and the page's
 * start-state is not, and both render this.
 */
export type StatedReasonProps = {
  /** Sentence-case statement of what is true. Also names the group. */
  heading: string;
  /** Plain-words reason it is true. */
  because: string;
  /** Plain-words statement of what would change it. If nothing would, say exactly that. */
  changedBy: string;
  /** Optional already-built icon, `aria-hidden`. The words carry the meaning; the icon repeats it. */
  icon?: ReactNode;
};

export function StatedReason({ heading, because, changedBy, icon }: StatedReasonProps) {
  return (
    <div
      role="group"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        {icon}
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {because}
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        {changedBy}
      </p>
    </div>
  );
}
