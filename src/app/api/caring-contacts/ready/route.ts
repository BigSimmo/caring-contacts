// Sovereign Caring Contacts readiness probe.
// Used by deploy/australia Dockerfile + compose healthchecks so orchestrators
// mark the service healthy only when the Caring Contacts store (dedicated DB
// or intentional in-memory demo) is reachable — not merely shared Supabase.
import { Pool } from "pg";
import { NextResponse } from "next/server";

import { assertNotClinicalKbProject, caringContactsDatabaseUrl } from "@/lib/caring-contacts-server/config";
import { isCaringContactsDemoEnabled, isCaringContactsLiveEnabled } from "@/lib/caring-contacts-server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const url = caringContactsDatabaseUrl();

  if (url) {
    let pool: Pool | null = null;
    try {
      assertNotClinicalKbProject(url);
      pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 5_000 });
      await pool.query("select 1 as ok");
      return NextResponse.json(
        { ok: true, store: "postgres", caringContactsDatabase: "ok" },
        { status: 200, headers: { "Cache-Control": "no-store" } },
      );
    } catch {
      return NextResponse.json(
        { ok: false, store: "postgres", caringContactsDatabase: "error" },
        { status: 503, headers: { "Cache-Control": "no-store" } },
      );
    } finally {
      if (pool) {
        try {
          await pool.end();
        } catch {
          // ignore pool teardown faults on the readiness path
        }
      }
    }
  }

  // No dedicated DB: live mode must fail closed; demo / non-production may use in-memory.
  if (isCaringContactsLiveEnabled() || process.env.CARING_CONTACTS_DEMO_ENABLED === "false") {
    return NextResponse.json(
      { ok: false, store: "missing", caringContactsDatabase: "missing" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isCaringContactsDemoEnabled() && process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { ok: false, store: "unavailable", caringContactsDatabase: "missing" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { ok: true, store: "in-memory", caringContactsDatabase: "skipped" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
