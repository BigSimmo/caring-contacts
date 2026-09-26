"use client";

import { AlertCircle, Check, Clock3, LoaderCircle, LockKeyhole, WifiOff } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { OperationalStatus } from "./prototype-primitives";

function StateTile({
  title,
  children,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <article
      className={`min-w-0 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--surface)] p-[var(--pad-card)] ${className}`}
    >
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-3 min-w-0">{children}</div>
    </article>
  );
}

export function ComponentStateSpecimens() {
  const [interactionOutcome, setInteractionOutcome] = useState("No interaction specimen selected.");

  return (
    <div className="space-y-[var(--gap-block)]" data-testid="caring-contact-component-states">
      <p className="text-sm text-[color:var(--text-muted)]">
        Every state carries visible words and a non-colour mark. These specimens demonstrate interaction, content,
        system and accessibility modes without patient information.
      </p>
      <p
        role="status"
        aria-live="polite"
        data-testid="component-interaction-outcome"
        className="rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-inset)] p-3 text-sm font-medium"
      >
        {interactionOutcome}
      </p>
      <div className="grid min-w-0 gap-[var(--gap-stack)] sm:grid-cols-2 xl:grid-cols-3">
        <StateTile title="Default">
          <Button variant="secondary" onClick={() => setInteractionOutcome("Default action: Review details opened.")}>
            Review details
          </Button>
        </StateTile>
        <StateTile title="Hover">
          <Button
            variant="secondary"
            onClick={() => setInteractionOutcome("Hover action: Hover specimen selected.")}
            className="border-[color:var(--border-strong)] bg-[color:var(--surface-subtle)]"
          >
            Hover specimen
          </Button>
        </StateTile>
        <StateTile title="Active">
          <Button
            variant="primary"
            onClick={() => setInteractionOutcome("Active action: Active specimen activated.")}
            className="translate-y-px shadow-[var(--e0)]"
          >
            Active specimen
          </Button>
        </StateTile>
        <StateTile title="Focus visible">
          <Button
            variant="secondary"
            onClick={() => setInteractionOutcome("Focus-visible action: Focus-visible specimen confirmed.")}
            className="outline outline-2 outline-offset-2 outline-[color:var(--focus)]"
          >
            Focus-visible specimen
          </Button>
        </StateTile>
        <StateTile title="Unavailable">
          <Button
            variant="secondary"
            aria-disabled="true"
            onClick={(event) => event.preventDefault()}
            title="Unavailable — approval evidence is missing"
          >
            Approval evidence missing
          </Button>
          <p className="mt-2 text-xs text-[color:var(--text-muted)]">Reason and remedy remain keyboard-reachable.</p>
        </StateTile>
        <StateTile title="Busy">
          <Button variant="primary" onClick={(event) => event.preventDefault()} busy busyLabel="Recording review…">
            Record review
          </Button>
        </StateTile>
        <StateTile title="Invalid">
          <label htmlFor="invalid-specimen" className="text-xs font-medium">
            Reason
          </label>
          <input
            id="invalid-specimen"
            aria-invalid="true"
            aria-describedby="invalid-specimen-error"
            value=""
            readOnly
            className="mt-1 min-h-tap w-full rounded-[var(--radius-md)] border border-[color:var(--danger)] bg-[color:var(--surface-inset)] px-3"
          />
          <p id="invalid-specimen-error" className="mt-1 flex items-start gap-1 text-xs text-[color:var(--danger)]">
            <AlertCircle aria-hidden="true" className="size-icon-sm shrink-0" /> Enter a structured operational reason.
          </p>
        </StateTile>
        <StateTile title="Empty">
          <p className="text-sm text-[color:var(--text-muted)]">No named exceptions for this day.</p>
        </StateTile>
        <StateTile title="Long content">
          <p className="break-words text-sm text-[color:var(--text-muted)]">
            Exception-owner-with-an-intentionally-long-fictional-display-name@example.invalid · full value wraps and
            remains available without clipping.
          </p>
        </StateTile>
        <StateTile title="Compact" className="max-w-64">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="font-semibold">10:00 am AWST</span>
            <OperationalStatus tone="neutral">Scheduled</OperationalStatus>
          </div>
        </StateTile>
        <StateTile
          title="Dark"
          className="dark ckb-v2 border-[color:var(--border)] bg-[color:var(--surface-raised)] text-[color:var(--text)]"
        >
          <p className="text-sm text-[color:var(--text-muted)]">Raised surfaces use the dark luminance ladder.</p>
        </StateTile>
        <StateTile
          title="Forced colour"
          className="forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]"
        >
          <p className="flex items-start gap-2 text-sm">
            <Check aria-hidden="true" className="size-icon-md shrink-0 forced-colors:text-[CanvasText]" /> System colour
            plus visible state words.
          </p>
        </StateTile>
        <StateTile title="Reduced motion">
          <p className="flex items-start gap-2 text-sm motion-reduce:transition-none">
            <Clock3 aria-hidden="true" className="size-icon-md shrink-0" /> Transitions stop; chronology remains
            unchanged.
          </p>
        </StateTile>
        <StateTile title="Loading">
          <p className="flex items-start gap-2 text-sm" role="status">
            <LoaderCircle
              aria-hidden="true"
              className="size-icon-md shrink-0 motion-safe:animate-spin motion-reduce:animate-none"
            />{" "}
            Loading operational records…
          </p>
        </StateTile>
        <StateTile title="Error">
          <p className="flex items-start gap-2 text-sm">
            <AlertCircle aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--danger)]" /> Records
            could not be loaded. Retry or return to Today.
          </p>
        </StateTile>
        <StateTile title="Offline">
          <p className="flex items-start gap-2 text-sm">
            <WifiOff aria-hidden="true" className="size-icon-md shrink-0" /> Offline — patient data is not cached;
            activation and sending fail closed.
          </p>
        </StateTile>
        <StateTile title="Authentication required">
          <p className="flex items-start gap-2 text-sm">
            <LockKeyhole aria-hidden="true" className="size-icon-md shrink-0" /> Session expired. Sign in again before
            continuing.
          </p>
        </StateTile>
        <StateTile title="Permission unavailable">
          <p className="flex items-start gap-2 text-sm">
            <LockKeyhole aria-hidden="true" className="size-icon-md shrink-0" /> Your role cannot perform this action.
            Contact the team lead.
          </p>
        </StateTile>
        <StateTile title="Version conflict">
          <p className="flex items-start gap-2 text-sm">
            <AlertCircle aria-hidden="true" className="size-icon-md shrink-0 text-[color:var(--warning)]" /> A governed
            version changed. Review both versions before resolving.
          </p>
        </StateTile>
      </div>
    </div>
  );
}
