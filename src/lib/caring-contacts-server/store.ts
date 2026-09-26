// src/lib/caring-contacts-server/store.ts
//
// The one place route handlers ask for a caring-contact store. Picks the store the same way the
// rest of this seam works: postgres when CARING_CONTACTS_DATABASE_URL is configured AND demo mode
// is off (live durable path; cleared by assertNotClinicalKbProject), the in-memory reference store
// otherwise -- so the workspace runs with no database at all. Demo mode never opens Postgres: a
// durable URL under forgeable demo actors is refused. That in-memory fallback is what the demo and
// this repository's offline test suite run against.
//
// Memoised on the first call, then reused. Two reasons, not one:
//   * the Postgres branch would otherwise build a brand-new `pg.Pool` on every call -- and once a
//     route handler calls this per request (Task 14+), that is unbounded connection growth with
//     nothing ever ending a pool;
//   * the in-memory branch holds the workspace's only copy of its data (Maps in
//     ../caring-contacts/in-memory-repository.ts). An unmemoised call would hand back a fresh,
//     empty store on every request, and nothing written by one request would ever be visible to
//     the next -- silently breaking the demo, not just wasting resources.
// Memoisation is pinned on `globalThis`, not a module-scoped `let`. Turbopack gives App Router
// pages and route handlers separate module registries under `next dev`, so a module-level
// singleton is instantiated twice: a stop posted to `/api/caring-contacts/service-state` would
// update the route-handler store while `src/app/caring-contacts/page.tsx` still read a running
// copy and omit the safety banner. `globalThis` is process-wide in the Node runtime this seam
// uses (`export const runtime = "nodejs"`), which is the same pattern `api-rate-limit.ts` and
// `upload-admission.ts` already use for cross-module process state. The production webpack
// build already shared one instance through Node's require cache; this makes the demo store
// match that under Turbopack too. The Clinical-KB-separation guard still runs before a pool is
// ever constructed, including on this first call -- memoisation only means it runs once, never
// that it is skipped.
import "server-only";

import { systemClock } from "@/lib/caring-contacts/clock";
import { createPostgresRepository } from "@/lib/caring-contacts/db/postgres-repository";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

import { assertNotClinicalKbProject, caringContactsDatabaseUrl } from "./config";
import { createDemoWorkspaceStore } from "./demo-seed";
import { createCaringContactsPool } from "./pool";
import { liveRestartApprovalSeats } from "./restart-approval-seats";

export const CARING_CONTACTS_STORE_GLOBAL_KEY = "__caringContactsCachedStore";

type GlobalWithCaringContactsStore = typeof globalThis & {
  [CARING_CONTACTS_STORE_GLOBAL_KEY]?: Promise<CaringContactRepository>;
};

export async function caringContactsStore(): Promise<CaringContactRepository> {
  const runtime = globalThis as GlobalWithCaringContactsStore;
  runtime[CARING_CONTACTS_STORE_GLOBAL_KEY] ??= buildStore();
  return runtime[CARING_CONTACTS_STORE_GLOBAL_KEY];
}

async function buildStore(): Promise<CaringContactRepository> {
  const url = caringContactsDatabaseUrl();
  // Fail closed: an explicit demo flag must never bind forgeable/default demo actors to a durable
  // patient database. Demo uses in-memory only. Durable Postgres requires live mode
  // (CARING_CONTACTS_DEMO_ENABLED=false) with a signed production session path — never
  // unauthenticated demo writes against real PHI storage.
  //
  // Checked against the explicit env flag (not isCaringContactsDemoEnabled()): non-production
  // always enables demo actors for local/Playwright work, and developers may still point at a
  // dedicated non-patient Postgres there. The sovereign misconfig is DEMO_ENABLED=true + a real DB.
  if (url && process.env.CARING_CONTACTS_DEMO_ENABLED === "true") {
    throw new Error(
      "Caring Contacts refuses CARING_CONTACTS_DATABASE_URL while CARING_CONTACTS_DEMO_ENABLED=true. " +
        "Demo actors are forgeable/defaulted; use in-memory demo (unset DATABASE_URL) or live mode " +
        "(CARING_CONTACTS_DEMO_ENABLED=false with session HMAC and DATABASE_URL).",
    );
  }
  if (!url) {
    // Live mode refuses the in-memory fallback: authenticated real-patient writes must not
    // appear durable while sitting only in process memory.
    if (process.env.CARING_CONTACTS_DEMO_ENABLED === "false") {
      throw new Error(
        "Caring Contacts live mode requires CARING_CONTACTS_DATABASE_URL; refusing in-memory fallback for real-patient writes.",
      );
    }
    // The demo population lives on THIS branch and only this one. `createDemoWorkspaceStore`
    // constructs the in-memory repository itself, so the seed has no parameter through which a
    // database-backed store could arrive, and nothing below this `if` can reach it -- see
    // ./demo-seed.ts and tests/caring-contacts-demo-seed.test.ts, which fails if the Postgres
    // branch ever calls it. It returns the store unpopulated where the demo is unavailable, so a
    // production process still gets an empty store rather than synthetic content.
    return createDemoWorkspaceStore(systemClock());
  }

  // Kept alongside createCaringContactsPool's own internal check -- defence in depth on the one
  // path that ever constructs a pool, not a substitute for it.
  assertNotClinicalKbProject(url);
  const pool = createCaringContactsPool(url);
  // Live governance configuration: who holds each service-restart approval seat. Unset means
  // nobody, so a stop cannot be restarted until an operator names the seat holders.
  return createPostgresRepository(pool, systemClock(), { restartApprovalSeats: liveRestartApprovalSeats() });
}
