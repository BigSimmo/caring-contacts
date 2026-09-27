// src/components/caring-contacts/workspace/plan-wizard/wizard-styles.ts
//
// The class strings the wizard's stages and fields share.
// Split out of `plan-wizard.tsx` unchanged. No "use client": it runs on the client through the wizard,
// and `tests/caring-contacts-explained-automation.dom.test.tsx` follows the wizard's imports into it.
import { floatingControl, primaryControl } from "@/components/ui-primitives";

import { workspacePanelPadded } from "../surfaces";

export const panelClass = workspacePanelPadded;

/**
 * The wizard's decisive command, on the shared recipe rather than a local accent fill.
 *
 * It was a filled `--clinical-accent` control, which put TWO filled primaries in TWO colours into
 * one decision: pressing "Create and start this plan" opens an overlay whose own confirm is
 * `primaryControl`, i.e. filled `--command`. `ckb-v2-tokens.css` states the rule this broke —
 * one filled `--command` button per surface, and Clinical Sky is for navigation and selection,
 * which is already how `aria-[current]` is drawn on the filter chips and the schedule day strip.
 * Activating a plan is a decisive command, so Graphite is the right role for it and the overlay
 * behind it now agrees.
 *
 * `primaryControl` also brings `controlBase` with it, which supplies `min-h-tap`, the focus ring,
 * `forced-colors:border`, `active:translate-y-px` and `controlDisabled`. That last one is a
 * deliberate, visible change: a disabled label lands on `--disabled` rather than `--text-muted`,
 * because the design system encodes disabled (flatten the fill, drop the shadow, remove the press)
 * instead of dimming label and fill together with an opacity. The wizard's disabled states are
 * transient and use the native attribute, which WCAG's contrast criterion exempts.
 */
export const primaryControlClass = `${primaryControl} min-w-0`;

export const secondaryControlClass = `${floatingControl} min-w-0`;

export const optionRowClass =
  "min-w-0 border-t border-[color:var(--border)] px-4 py-2 text-left first:border-t-0 focus-within:outline focus-within:outline-2 focus-within:outline-offset-[-0.125rem] focus-within:outline-[color:var(--focus)]";

/**
 * `min-h-tap` sits on the LABEL, not on the row around it — round 1, finding I-2.
 *
 * A 48px `<div>` wrapping a 20px radio and a one-line label is 48px of layout and about 20px of
 * activation surface: on a phone the rest of the row is dead space that looks tappable. The label
 * is what a tap activates, so the label is what has to be 48px tall, exactly as the stage-1
 * confirmations already do it. `min-h-12` (48px) and never `min-h-11`: this repo's production tap
 * floor exceeds even the AAA-level 44px criterion, because 44px hit a sub-pixel rounding flake in
 * `ui-smoke`.
 */
export const optionLabelClass = "flex min-h-tap w-full min-w-0 cursor-pointer items-center gap-3";

export const mutedTextClass = "max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]";

/**
 * A text input or textarea. `min-h-tap` for the same reason every other control here carries it:
 * a production tap target is 48px, and never `min-h-11` — 44px hit a sub-pixel rounding flake in
 * `ui-smoke`, so this repo's floor exceeds even the AAA-level criterion deliberately.
 */
export const fieldClass =
  "min-h-tap w-full min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

export const headingClass = "text-sm font-semibold text-[color:var(--text-heading)]";
