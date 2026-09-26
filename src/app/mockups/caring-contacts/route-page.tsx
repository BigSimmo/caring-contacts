import { Suspense } from "react";

import { CaringContactRoutableSuite } from "@/components/caring-contacts/mockups/routable-suite";

function CaringContactRouteFallback() {
  return (
    <main
      aria-busy="true"
      aria-label="Loading Caring Contact prototype"
      className="min-h-dvh bg-[color:var(--background)] p-5 text-[color:var(--text)]"
    >
      <div className="mx-auto max-w-[74rem] space-y-4 motion-reduce:animate-none">
        <div className="h-12 w-56 animate-pulse rounded-[var(--radius-md)] bg-[color:var(--surface-inset)] motion-reduce:animate-none" />
        <div className="h-28 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
        <div className="grid gap-4 md:grid-cols-2">
          <div className="h-72 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
          <div className="h-72 animate-pulse rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--surface)] motion-reduce:animate-none" />
        </div>
      </div>
    </main>
  );
}

export function CaringContactRoutePage() {
  return (
    <Suspense fallback={<CaringContactRouteFallback />}>
      <CaringContactRoutableSuite />
    </Suspense>
  );
}
