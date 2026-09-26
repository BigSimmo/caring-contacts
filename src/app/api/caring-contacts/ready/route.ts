// Sovereign Caring Contacts readiness probe.
// Used by deploy/australia Dockerfile + compose healthchecks so orchestrators
// mark the service healthy only when the Caring Contacts store (dedicated DB
// or intentional in-memory demo) is reachable — not merely shared Supabase.
//
// It also answers two questions about the parts that alert staff (feature: staff alert delivery):
//
//   * sender -- is the background sender still finishing runs? "running", "starting" (inside the
//     start-up grace), "stalled", "unknown" (the heartbeat could not be read) or "not-monitored".
//     THE RULE: a stalled or unknown sender makes this probe answer 503 ONLY when real text
//     messages are switched on or live mode is on (`senderMonitoringRequired`). In the demo and
//     with simulated sending there is often no sender at all, so it is reported and never fails
//     the probe. A stalled sender also raises the always-delivered "sender stalled" staff alert
//     from here -- the sender cannot report its own death -- under the durable cooldown, without
//     holding up this answer.
//   * alerts -- how staff alerts leave the app: "simulated", "webhook", or "misconfigured" when
//     the alert settings are refused. Misconfigured answers 503 in every mode: somebody asked for
//     alerts to go somewhere and they cannot.
//
// Every field is a fixed word. Nothing here names a patient, a number, a team or an address.
import { Pool } from "pg";
import { NextResponse } from "next/server";

import { assertNotClinicalKbProject, caringContactsDatabaseUrl } from "@/lib/caring-contacts-server/config";
import { isCaringContactsDemoEnabled, isCaringContactsLiveEnabled } from "@/lib/caring-contacts-server/session";
import {
  alertDeliveryStatus,
  checkSender,
  raiseSenderStalledAlert,
  senderMonitoringRequired,
  type SenderCheck,
} from "@/lib/caring-contacts-server/staff-alerts";
import { caringContactsStore } from "@/lib/caring-contacts-server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type StoreProbe = { ok: boolean; store: string; caringContactsDatabase: string };

async function probeStore(): Promise<StoreProbe> {
  const url = caringContactsDatabaseUrl();

  if (url) {
    let pool: Pool | null = null;
    try {
      assertNotClinicalKbProject(url);
      pool = new Pool({ connectionString: url, max: 1, idleTimeoutMillis: 1_000, connectionTimeoutMillis: 5_000 });
      await pool.query("select 1 as ok");
      return { ok: true, store: "postgres", caringContactsDatabase: "ok" };
    } catch {
      return { ok: false, store: "postgres", caringContactsDatabase: "error" };
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
    return { ok: false, store: "missing", caringContactsDatabase: "missing" };
  }

  if (!isCaringContactsDemoEnabled() && process.env.NODE_ENV === "production") {
    return { ok: false, store: "unavailable", caringContactsDatabase: "missing" };
  }

  return { ok: true, store: "in-memory", caringContactsDatabase: "skipped" };
}

const SENDER_WORD: Record<SenderCheck["status"], string> = {
  notMonitored: "not-monitored",
  running: "running",
  starting: "starting",
  stalled: "stalled",
  unknown: "unknown",
};

export async function GET() {
  const probe = await probeStore();
  if (!probe.ok) {
    // The store itself is not usable: nothing else can be read, so nothing else is reported.
    return NextResponse.json(probe, { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  let sender: SenderCheck = { status: "notMonitored", reason: null };
  try {
    // Not monitored means the store is not even opened for this: the probe answers as it always did.
    if (senderMonitoringRequired()) {
      const store = await caringContactsStore();
      sender = await checkSender(store);
      if (sender.status === "stalled") {
        // Not awaited: an alert webhook may take seconds, and the orchestrator's probe must not
        // wait on it. `raiseSenderStalledAlert` never throws; the catch is belt and braces.
        void raiseSenderStalledAlert(store, sender).catch(() => undefined);
      }
    }
  } catch {
    sender = { status: "unknown", reason: null };
  }
  const alerts = alertDeliveryStatus();

  const ok = sender.status !== "stalled" && sender.status !== "unknown" && alerts !== "misconfigured";
  return NextResponse.json(
    { ...probe, ok, sender: SENDER_WORD[sender.status], alerts },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
