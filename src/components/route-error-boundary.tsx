"use client";

import { useEffect, useRef } from "react";
import { TriangleAlert, RefreshCw, ClipboardCopy, Check } from "lucide-react";

import { cn, primaryControl } from "@/components/ui-primitives";
import { useCopyDiagnostics } from "@/lib/use-copy-diagnostics";

export type RouteErrorBoundaryProps = {
  /** The error thrown by the segment, forwarded by Next.js. */
  error: Error & { digest?: string };
  /** Re-renders the segment from scratch, forwarded by Next.js. */
  reset: () => void;
  /** Heading shown above the recovery actions. */
  title?: string;
  /** Explanatory copy under the heading. */
  description?: string;
  /** Prefix used when logging the error to the console. */
  logLabel?: string;
  /** Whether to offer a full page reload in addition to `reset()`. */
  showReload?: boolean;
  /** Minimum-height utility so route segments and the app shell can size differently. */
  minHeightClass?: string;
};

/**
 * Shared recovery panel for App Router `error.tsx` boundaries. Centralising the
 * markup keeps every segment boundary visually and behaviourally consistent and
 * removes the copy-paste friction that previously left new routes without a
 * boundary at all. Individual `error.tsx` files stay as the thin default exports
 * Next.js requires and delegate here.
 */
export function RouteErrorBoundary({
  error,
  reset,
  title = "Something went wrong",
  description = "An unexpected error occurred. You can try to reset the current view or refresh the browser.",
  logLabel = "Unhandled runtime error captured by boundary:",
  showReload = false,
  minHeightClass = "min-h-[50vh]",
}: RouteErrorBoundaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { copied, copyFailed, copyDiagnostics } = useCopyDiagnostics(error);

  useEffect(() => {
    console.error(logLabel, error);
    headingRef.current?.focus({ preventScroll: true });
  }, [error, logLabel]);

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center bg-[color:var(--surface-lux)] px-4 font-sans text-[color:var(--text)] select-none",
        minHeightClass,
      )}
    >
      <div className="w-full max-w-md rounded-2xl border border-[color:var(--border)] bg-[color:var(--surface-raised)] p-6 text-center shadow-[var(--shadow-elevated)]">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--danger-soft)] text-[color:var(--danger)]">
          <TriangleAlert aria-hidden="true" className="h-6 w-6" />
        </div>

        <h1
          ref={headingRef}
          tabIndex={-1}
          className="mt-4 text-lg font-semibold tracking-tight text-[color:var(--text-heading)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
        >
          {title}
        </h1>

        <p role="alert" className="mt-2 text-sm leading-relaxed text-[color:var(--text-muted)]">
          {description}
        </p>

        {error.digest && (
          <div className="mt-4 rounded-lg bg-[color:var(--surface-subtle)] p-2 font-mono text-xs text-[color:var(--text-muted)]">
            Digest: {error.digest}
          </div>
        )}

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className={cn(primaryControl, "flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium")}
          >
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            Try again
          </button>

          {showReload && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
            >
              Reload page
            </button>
          )}

          <button
            type="button"
            onClick={copyDiagnostics}
            className="flex items-center justify-center gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-4 py-2 text-sm font-medium text-[color:var(--text)] transition hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
          >
            {copied ? (
              <Check aria-hidden="true" className="h-4 w-4 text-green-600" />
            ) : (
              <ClipboardCopy aria-hidden="true" className="h-4 w-4" />
            )}
            {copied ? "Copied Diagnostics" : copyFailed ? "Copy failed — try again" : "Copy Diagnostics"}
          </button>
        </div>
      </div>
    </div>
  );
}
