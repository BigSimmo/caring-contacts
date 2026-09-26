// tests/caring-contacts-retry-queue.test.ts
import { describe, expect, it } from "vitest";

import {
  calculateNextRetryTime,
  calculateRetryDelayMs,
  MAX_RETRY_ATTEMPTS,
  NotificationRetryQueue,
  RETRY_BACKOFF_LADDER_MS,
} from "@/lib/caring-contacts/retry-queue";

describe("Task 4 #8K9W2B: Notification retry queue backoff ladder", () => {
  it("synchronizes retry scheduler with the documented exponential ladder (1m, 5m, 15m, 1h, 6h)", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(5);
    expect(RETRY_BACKOFF_LADDER_MS).toEqual([
      60_000, // 1m
      300_000, // 5m
      900_000, // 15m
      3_600_000, // 1h
      21_600_000, // 6h
    ]);
  });

  it("handles zero-retry queue records (attemptCount = 0) cleanly", () => {
    // Zero-retry records must receive the 1m delay
    const delay = calculateRetryDelayMs(0);
    expect(delay).toBe(60_000);

    const now = new Date("2026-09-07T10:00:00.000Z");
    const nextTime = calculateNextRetryTime(0, now);
    expect(nextTime?.toISOString()).toBe("2026-09-07T10:01:00.000Z");
  });

  it("calculates delay correctly for each step of the ladder", () => {
    expect(calculateRetryDelayMs(0)).toBe(60_000); // 1m
    expect(calculateRetryDelayMs(1)).toBe(300_000); // 5m
    expect(calculateRetryDelayMs(2)).toBe(900_000); // 15m
    expect(calculateRetryDelayMs(3)).toBe(3_600_000); // 1h
    expect(calculateRetryDelayMs(4)).toBe(21_600_000); // 6h
  });

  it("returns null when max attempts (5) are exhausted", () => {
    expect(calculateRetryDelayMs(5)).toBeNull();
    expect(calculateRetryDelayMs(6)).toBeNull();
  });

  it("enqueues and advances retry queue items through failures to dead-letter", () => {
    const queue = new NotificationRetryQueue();
    const t0 = new Date("2026-09-07T08:00:00.000Z");

    // Initial enqueue (attempt 0 -> next retry at +1m)
    const item = queue.enqueue({
      id: "retry-1",
      notificationId: "notif-1",
      planId: "plan-1",
      contactId: "contact-1",
      recipientId: "recip-1",
      now: t0,
    });

    expect(item.attemptCount).toBe(0);
    expect(item.status).toBe("pending");
    expect(item.nextRetryAt).toBe("2026-09-07T08:01:00.000Z"); // +1m

    // Attempt 1 fails at 08:01 -> next retry at +5m (08:06)
    const t1 = new Date("2026-09-07T08:01:00.000Z");
    const fail1 = queue.recordFailure("retry-1", "network timeout", t1);
    expect(fail1.attemptCount).toBe(1);
    expect(fail1.status).toBe("pending");
    expect(fail1.nextRetryAt).toBe("2026-09-07T08:06:00.000Z");

    // Attempt 2 fails at 08:06 -> next retry at +15m (08:21)
    const t2 = new Date("2026-09-07T08:06:00.000Z");
    const fail2 = queue.recordFailure("retry-1", "network timeout", t2);
    expect(fail2.attemptCount).toBe(2);
    expect(fail2.nextRetryAt).toBe("2026-09-07T08:21:00.000Z");

    // Attempt 3 fails at 08:21 -> next retry at +1h (09:21)
    const t3 = new Date("2026-09-07T08:21:00.000Z");
    const fail3 = queue.recordFailure("retry-1", "network timeout", t3);
    expect(fail3.attemptCount).toBe(3);
    expect(fail3.nextRetryAt).toBe("2026-09-07T09:21:00.000Z");

    // Attempt 4 fails at 09:21 -> next retry at +6h (15:21)
    const t4 = new Date("2026-09-07T09:21:00.000Z");
    const fail4 = queue.recordFailure("retry-1", "network timeout", t4);
    expect(fail4.attemptCount).toBe(4);
    expect(fail4.nextRetryAt).toBe("2026-09-07T15:21:00.000Z");

    // Attempt 5 fails at 15:21 -> dead_letter, no further retries
    const t5 = new Date("2026-09-07T15:21:00.000Z");
    const fail5 = queue.recordFailure("retry-1", "upstream gateway error", t5);
    expect(fail5.attemptCount).toBe(5);
    expect(fail5.status).toBe("dead_letter");
    expect(fail5.nextRetryAt).toBeNull();
  });

  it("marks successful retries completed", () => {
    const queue = new NotificationRetryQueue();
    const t0 = new Date("2026-09-07T08:00:00.000Z");

    queue.enqueue({
      id: "retry-success",
      notificationId: "notif-2",
      planId: "plan-2",
      contactId: "contact-2",
      recipientId: "recip-2",
      now: t0,
    });

    const success = queue.recordSuccess("retry-success", new Date("2026-09-07T08:01:00.000Z"));
    expect(success.status).toBe("completed");
    expect(success.nextRetryAt).toBeNull();
    expect(success.completedAt).toBe("2026-09-07T08:01:00.000Z");
  });

  it("filters pending retries due at given time", () => {
    const queue = new NotificationRetryQueue();
    const t0 = new Date("2026-09-07T08:00:00.000Z");

    queue.enqueue({
      id: "item-1",
      notificationId: "n1",
      planId: "p1",
      contactId: "c1",
      recipientId: "r1",
      now: t0, // next retry at 08:01
    });

    // Before 08:01 -> no pending retries
    expect(queue.getPendingRetries(new Date("2026-09-07T08:00:30.000Z"))).toHaveLength(0);

    // At 08:01 -> item-1 is due
    const pending = queue.getPendingRetries(new Date("2026-09-07T08:01:00.000Z"));
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe("item-1");
  });

  it("immediately marks records enqueued with attemptCount >= 5 as dead_letter", () => {
    const queue = new NotificationRetryQueue();
    const item = queue.enqueue({
      id: "already-exhausted",
      notificationId: "n-exhausted",
      planId: "p-1",
      contactId: "c-1",
      recipientId: "r-1",
      attemptCount: 5,
    });

    expect(item.attemptCount).toBe(5);
    expect(item.status).toBe("dead_letter");
    expect(item.nextRetryAt).toBeNull();
    // Must not be returned in pending retries
    expect(queue.getPendingRetries(new Date("2099-01-01"))).toHaveLength(0);
  });

  it("clamps negative attemptCount on enqueue to 0 to prevent excessive retries", () => {
    const queue = new NotificationRetryQueue();
    const item = queue.enqueue({
      id: "neg-attempt",
      notificationId: "n-neg",
      planId: "p-1",
      contactId: "c-1",
      recipientId: "r-1",
      attemptCount: -5,
    });

    expect(item.attemptCount).toBe(0);
    expect(item.status).toBe("pending");
    expect(item.nextRetryAt).not.toBeNull();
  });

  it("handles non-integer and NaN attempt counts in calculateRetryDelayMs", () => {
    // Non-integer floors to matching ladder index
    expect(calculateRetryDelayMs(1.9)).toBe(300_000); // index 1 (5m)
    expect(calculateRetryDelayMs(3.2)).toBe(3_600_000); // index 3 (1h)

    // NaN or negative fallback to first ladder step
    expect(calculateRetryDelayMs(NaN)).toBe(60_000);
    expect(calculateRetryDelayMs(-1)).toBe(60_000);

    // Greater than or equal to max attempts returns null
    expect(calculateRetryDelayMs(5.5)).toBeNull();
  });

  it("preserves dead_letter state and prevents rescheduling if failed after max attempts", () => {
    const queue = new NotificationRetryQueue();
    const t0 = new Date("2026-09-07T10:00:00.000Z");

    queue.enqueue({
      id: "dead-item",
      notificationId: "n-dead",
      planId: "p-1",
      contactId: "c-1",
      recipientId: "r-1",
      attemptCount: 4,
      now: t0,
    });

    // 5th attempt fails -> dead letter
    const dead = queue.recordFailure("dead-item", "fail 5", new Date("2026-09-07T10:05:00.000Z"));
    expect(dead.status).toBe("dead_letter");
    expect(dead.nextRetryAt).toBeNull();

    // Calling recordFailure again on an already dead-lettered item does not reschedule
    const postDead = queue.recordFailure("dead-item", "subsequent error", new Date("2026-09-07T10:10:00.000Z"));
    expect(postDead.status).toBe("dead_letter");
    expect(postDead.nextRetryAt).toBeNull();
    expect(postDead.lastError).toBe("subsequent error");
  });

  it("refuses to record failure on an already completed item", () => {
    const queue = new NotificationRetryQueue();
    queue.enqueue({
      id: "completed-item",
      notificationId: "n-comp",
      planId: "p-1",
      contactId: "c-1",
      recipientId: "r-1",
    });

    queue.recordSuccess("completed-item");

    expect(() => {
      queue.recordFailure("completed-item", "late arrival failure");
    }).toThrow(/Cannot record failure on completed retry item/);
  });

  it("guards against clock drift backwards and negative base dates", () => {
    const queue = new NotificationRetryQueue();
    const t0 = new Date("2026-09-07T12:00:00.000Z");

    queue.enqueue({
      id: "clock-drift-item",
      notificationId: "n-drift",
      planId: "p-1",
      contactId: "c-1",
      recipientId: "r-1",
      now: t0,
    });

    // Clock steps backwards to 11:00:00 (1 hour before creation)
    const driftedPast = new Date("2026-09-07T11:00:00.000Z");
    const updated = queue.recordFailure("clock-drift-item", "error with skewed clock", driftedPast);

    // Scheduled retry must NOT be scheduled in the past relative to createdAt
    expect(new Date(updated.nextRetryAt!).getTime()).toBeGreaterThanOrEqual(
      t0.getTime() + 300_000, // at least t0 + 5m
    );

    // Negative baseDate is normalized without crashing
    const nextWithNeg = calculateNextRetryTime(0, new Date(-1000));
    expect(nextWithNeg).not.toBeNull();
    expect(nextWithNeg!.getTime()).toBeGreaterThan(0);
  });
});
