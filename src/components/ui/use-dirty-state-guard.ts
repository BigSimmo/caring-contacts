"use client";

import { useEffect } from "react";

/**
 * Tab-close and external navigation dirty-state guard.
 *
 * Attaches a `beforeunload` listener strictly and only when `isDirty` is true.
 * Protects against accidental data loss when closing the tab, reloading the page,
 * or following external links while an unsaved clinical draft is present.
 *
 * Safe for SSR and test environments (`typeof window === "undefined"`).
 * Unbinds cleanly on unmount or when `isDirty` transitions to false, leaving
 * no `beforeunload` listener on window during client-side router navigation
 * (e.g. Next.js App Router `useRouter().push()`), preserving Back-Forward Cache (BFCache).
 */
export function useDirtyStateGuard(isDirty: boolean) {
  useEffect(() => {
    if (!isDirty || typeof window === "undefined") return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [isDirty]);
}
