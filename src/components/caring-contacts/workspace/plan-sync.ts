// src/components/caring-contacts/workspace/plan-sync.ts
//
// One plan, three panels: the patient page's Plan actions, Record a change and Check the number
// each write to the same plan, and each used to hold its OWN copy of the plan's version. A write in
// one panel answered with version N+1, but the other two kept N until `router.refresh()` landed, so
// a quick second change from a different panel sent a stale `expectedVersion` and was refused as
// `stale-version` -- a collision with a change this screen had just made. Each panel's "another
// change is on its way" guard also only knew about its own writes.
//
// This context is what they now share: the newest plan any panel has been told about by the
// service, and how many writes are in flight across all of them. Each panel still keeps its own
// state and still adopts the server's props; it additionally adopts `latest` when it is AHEAD of
// what the panel holds (monotone, for the same reason the prop sync is), and treats another
// panel's write in flight exactly like its own.
//
// NO "use client" HERE, DELIBERATELY, following `mobile-number-check.tsx`: the workspace keeps an
// explicit list of client boundaries, and this module adds none. It is imported only by client
// modules; the server-rendered patient page reaches the provider through `plan-actions.tsx`, which
// re-exports it.
//
// Outside a provider every consumer gets `NO_SYNC`, which shares nothing, so a panel rendered on its
// own (as every existing test renders it) behaves exactly as it did before.
import { createContext, createElement, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import type { PlanState } from "@/lib/caring-contacts/model";

import type { MobileCheckView } from "./patient-updates/patient-update-rules";

export type SharedPlan = {
  readonly state: PlanState;
  readonly version: number;
  /** Carried only by a write that answers with it; a panel that is not told keeps its own. */
  readonly mobileCheck?: MobileCheckView;
};

export type PlanSync = {
  /** The newest plan any panel on this page has been told about, or null before any write. */
  readonly latest: SharedPlan | null;
  /** Report a plan a write just answered with. Ignored unless it is newer than `latest`. */
  readonly publish: (plan: SharedPlan) => void;
  /** Writes to this plan in flight from ANY panel on the page, the caller's own included. */
  readonly writesInFlight: number;
  readonly beginWrite: () => void;
  readonly endWrite: () => void;
};

const NO_SYNC: PlanSync = Object.freeze({
  latest: null,
  publish: () => {},
  writesInFlight: 0,
  beginWrite: () => {},
  endWrite: () => {},
});

const PlanSyncContext = createContext<PlanSync>(NO_SYNC);

export function PlanSyncProvider({ children }: { children: ReactNode }) {
  const [latest, setLatest] = useState<SharedPlan | null>(null);
  const [writesInFlight, setWritesInFlight] = useState(0);

  const publish = useCallback((plan: SharedPlan) => {
    setLatest((current) => (current !== null && current.version >= plan.version ? current : plan));
  }, []);
  const beginWrite = useCallback(() => setWritesInFlight((count) => count + 1), []);
  const endWrite = useCallback(() => setWritesInFlight((count) => Math.max(0, count - 1)), []);

  const value = useMemo(
    () => ({ latest, publish, writesInFlight, beginWrite, endWrite }),
    [latest, publish, writesInFlight, beginWrite, endWrite],
  );
  return createElement(PlanSyncContext.Provider, { value }, children);
}

export function usePlanSync(): PlanSync {
  return useContext(PlanSyncContext);
}
