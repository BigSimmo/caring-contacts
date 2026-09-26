"use client";

import type { ReactNode } from "react";

import { cn, controlDisabled, ignoreUnavailableActivation } from "@/components/ui-primitives";

export type UnavailableDestinationProps = {
  /** Unique within one render; also names the screen-reader note this control points at. */
  id: string;
  /** Sentence-case destination name, exactly as it will read once built. */
  label: string;
  /** Plain-words statement of what the destination will hold once it is built. */
  reason: string;
  className?: string;
  /** Presentation for the destination; defaults to its label. */
  children?: ReactNode;
};

/**
 * A workspace destination that is declared but not built yet.
 *
 * Ruling 52: the navigation renders its whole destination set now, and an
 * unbuilt destination is an unavailable control with a stated reason — never a
 * link to a route that would 404.
 *
 * `docs/wiring-conventions.md`: such a control carries `aria-disabled="true"`
 * plus an inert handler, never the native `disabled` attribute, because native
 * `disabled` removes the tab stop and the stated reason could then never be
 * reached by keyboard. The two attributes are never used together;
 * `eslint-rules/require-button-wiring.mjs` fails on the pair.
 *
 * A client component, and one of a handful this workspace ships.
 *
 * Ruling 94: no count is stated here, and none should be added. This comment
 * once said "the only client component the production workspace ships", which
 * was true when written, stopped being true as the overlay half landed, and was
 * copied verbatim into three later files before anyone recounted. Its
 * replacement — "five" — was wrong within the same round, because it silently
 * scoped itself to this directory and omitted the route's own `error.tsx` and
 * the module that one pulls in. A tally in prose is a claim that decays every
 * time someone adds a file.
 *
 * What actually holds Ruling 13 is the MODULE BOUNDARY, which does not decay:
 * nothing outside the `/caring-contacts` route segment imports this workspace —
 * the tools catalogue names it by href, never by import — so the PsychSift
 * dashboard references no chunk exclusive to it, whatever this directory grows
 * to. A screen that adds no client component of its own therefore adds no client
 * payload, and that is the property worth checking, not the number of files.
 */
export function UnavailableDestination({ id, label, reason, className, children }: UnavailableDestinationProps) {
  const noteId = `caring-contacts-unavailable-${id}`;
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={noteId}
        title={`${label} — coming soon`}
        onClick={ignoreUnavailableActivation}
        className={cn(
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border",
          // The VISUAL half of unavailability, which this control shipped without.
          //
          // `aria-disabled` and the `sr-only` note below have always told assistive technology the
          // truth. A sighted person was told nothing: callers hand this component the same class
          // they hand the live `<Link>` beside it -- see `MorePanelDestination` in `shell.tsx` --
          // so seven unbuilt destinations rendered pixel-identical to three working ones, and the
          // first signal was the click doing nothing.
          //
          // `controlDisabled` is the design system's encoding for exactly this: flatten the fill to
          // `--surface-subtle`, put the label on `--disabled`, drop the shadow, remove the press.
          // It is deliberately an encoding rather than `opacity-50`, which dims label and fill
          // together and leaves a disabled control still reading as available. Its `aria-disabled:`
          // half exists FOR this case -- a control that carries the attribute and no native one --
          // and its `!` modifiers are what let it outrank whatever the caller passed.
          //
          // It goes here rather than at each call site so the encoding cannot be forgotten by the
          // next screen that renders an unbuilt destination.
          controlDisabled,
          className,
        )}
      >
        {children ?? <span className="truncate">{label}</span>}
      </button>
      <span id={noteId} className="sr-only">
        {label} is not built yet. {reason}
      </span>
    </>
  );
}
