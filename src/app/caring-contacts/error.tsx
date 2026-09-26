"use client";

import { ConnectionUnavailable } from "@/components/caring-contacts/workspace/connection-unavailable";
import { PermissionUnavailable } from "@/components/caring-contacts/workspace/permission-unavailable";
import { SyntheticMarker } from "@/components/caring-contacts/workspace/synthetic-marker";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

/**
 * Ruling 53: this boundary takes Next 16's `retry`, not the older `reset`.
 *
 * Older `error.tsx` files in this repository still take `reset`, and the
 * inconsistency here is deliberate rather than an oversight. `reset()` clears
 * the error state and re-renders the boundary's children *without re-fetching*
 * (Next 16 file-conventions/error.md), so on a workspace whose screens are
 * driven by data, "Try again" would re-render the same failed state and fail
 * again immediately — a control advertising an action it does not perform.
 * `retry()` re-fetches, which is what the button says it does.
 *
 * `RouteErrorBoundary`'s prop is still named `reset` because it is shared with
 * those older boundaries; what it receives here is Next's `retry`.
 */
export default function CaringContactsErrorBoundary({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const msg = (error?.message ?? "").toLowerCase();
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const isConnectionUnavailable =
    isOffline ||
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("connection-unavailable") ||
    msg.includes("offline");

  if (isConnectionUnavailable) {
    return <ConnectionUnavailable retry={retry} />;
  }

  const isPermissionUnavailable =
    msg.includes("403") ||
    msg.includes("forbidden") ||
    msg.includes("permission") ||
    msg.includes("unassigned") ||
    msg.includes("cross-team-denied") ||
    msg.includes("action-not-granted") ||
    msg.includes("no-roles") ||
    msg.includes("permission-unavailable");

  if (isPermissionUnavailable) {
    return <PermissionUnavailable retry={retry} />;
  }

  return (
    <>
      {/* Carried here too: a printout or screenshot of a failed workspace screen
          should still say that everything behind it is invented. */}
      <SyntheticMarker className="m-4" />
      <RouteErrorBoundary
        error={error}
        reset={retry}
        title="The Caring Contacts workspace could not be shown"
        description="Nothing was sent and nothing was changed. You can try again, or refresh the browser."
        logLabel="Unhandled runtime error captured by the Caring Contacts boundary:"
        showReload
        minHeightClass="min-h-dvh"
      />
    </>
  );
}
