// src/lib/caring-contacts/alerts/sender-health.ts
//
// Is the background sender alive? Pure: decides from the last heartbeat, the time now, when this
// app process started and the allowed gap. The readiness probe asks it; see
// src/app/api/caring-contacts/ready/route.ts for when the answer is allowed to make the app
// unhealthy.
//
// THE RULE, stated once:
//   * not monitored (the caller decides; see the probe)          -> "notMonitored"
//   * the last finished run is within `thresholdMs` of now        -> "running"
//   * otherwise, within `thresholdMs` of this process starting    -> "starting"   (grace)
//   * otherwise, never run                                        -> "stalled", sender-never-run
//   * otherwise                                                   -> "stalled", sender-run-overdue
//
// WHY A START-UP GRACE. The sender is an external timer calling this app. While the app was down
// (a deploy, a restart), every call failed, so the last heartbeat is old for a reason that has
// nothing to do with the sender. The app gives the sender one full threshold after it starts to
// call again before calling it stalled. A sender that is genuinely dead is reported after that.
import type { StaffAlertReason } from "./staff-alert";

export type SenderHealthStatus = "notMonitored" | "running" | "starting" | "stalled";

export type SenderHealth = {
  status: SenderHealthStatus;
  /** Why it is stalled; null otherwise. */
  reason: Extract<StaffAlertReason, "sender-never-run" | "sender-run-overdue"> | null;
};

export const DEFAULT_SENDER_STALL_THRESHOLD_MS = 15 * 60 * 1000;

export function senderHealth(input: {
  monitored: boolean;
  lastRunAt: Date | null;
  now: Date;
  processStartedAt: Date;
  thresholdMs: number;
}): SenderHealth {
  if (!input.monitored) return { status: "notMonitored", reason: null };
  const now = input.now.getTime();
  if (input.lastRunAt !== null && now - input.lastRunAt.getTime() <= input.thresholdMs) {
    return { status: "running", reason: null };
  }
  if (now - input.processStartedAt.getTime() <= input.thresholdMs) return { status: "starting", reason: null };
  return { status: "stalled", reason: input.lastRunAt === null ? "sender-never-run" : "sender-run-overdue" };
}
