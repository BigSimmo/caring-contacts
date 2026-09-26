"use client";

import { SyntheticMarker } from "@/components/caring-contacts/workspace/synthetic-marker";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export type PermissionUnavailableProps = {
  retry?: () => void;
  className?: string;
};

export function PermissionUnavailable({ retry, className }: PermissionUnavailableProps) {
  return (
    <div className={className} data-testid="permission-unavailable-view">
      <SyntheticMarker className="m-4" />
      <RouteErrorBoundary
        error={new Error("You do not have permission to carry out this action.")}
        reset={retry ?? (() => window.location.reload())}
        title="Permission unavailable"
        description="You do not have permission to carry out this action. The attempt is recorded and nothing has changed."
        logLabel="Permission denial detected in Caring Contacts workspace:"
        showReload
        minHeightClass="min-h-dvh"
      />
    </div>
  );
}
