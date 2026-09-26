"use client";

import { SyntheticMarker } from "@/components/caring-contacts/workspace/synthetic-marker";
import { RouteErrorBoundary } from "@/components/route-error-boundary";

export type ConnectionUnavailableProps = {
  retry?: () => void;
  className?: string;
};

export function ConnectionUnavailable({ retry, className }: ConnectionUnavailableProps) {
  return (
    <div className={className} data-testid="connection-unavailable-view">
      <SyntheticMarker className="m-4" />
      <RouteErrorBoundary
        error={new Error("There is no connection, so nothing can be changed from here.")}
        reset={retry ?? (() => window.location.reload())}
        title="Connection unavailable"
        description="There is no connection, so nothing can be changed from here. You can try connecting again, or refresh the browser."
        logLabel="Connection drop detected in Caring Contacts workspace:"
        showReload
        minHeightClass="min-h-dvh"
      />
    </div>
  );
}
