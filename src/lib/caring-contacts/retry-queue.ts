// src/lib/caring-contacts/retry-queue.ts
//
// Notification delivery retry queue and backoff scheduler.
//
// Bug fix #8K9W2B:
// Synchronizes retry scheduler with the documented clinical exponential backoff ladder:
// (1m, 5m, 15m, 1h, 6h).
// Correctly handles zero-retry queue records and dead-letters after 5 attempts.

/**
 * Exponential backoff intervals in milliseconds:
 * 1m = 60,000 ms
 * 5m = 300,000 ms
 * 15m = 900,000 ms
 * 1h = 3,600,000 ms
 * 6h = 21,600,000 ms
 */
export const RETRY_BACKOFF_LADDER_MS = Object.freeze([
  1 * 60 * 1000, // Attempt 1: 1m
  5 * 60 * 1000, // Attempt 2: 5m
  15 * 60 * 1000, // Attempt 3: 15m
  60 * 60 * 1000, // Attempt 4: 1h
  6 * 60 * 60 * 1000, // Attempt 5: 6h
]);

export const MAX_RETRY_ATTEMPTS = RETRY_BACKOFF_LADDER_MS.length; // 5

export type RetryItemStatus = "pending" | "processing" | "completed" | "dead_letter";

export type NotificationRetryItem = {
  id: string;
  notificationId: string;
  planId: string;
  contactId: string;
  recipientId: string;
  attemptCount: number;
  status: RetryItemStatus;
  createdAt: string;
  nextRetryAt: string | null;
  lastError?: string;
  completedAt?: string;
};

export type EnqueueRetryParams = {
  id?: string;
  notificationId: string;
  planId: string;
  contactId: string;
  recipientId: string;
  initialError?: string;
  attemptCount?: number;
  now?: Date;
};

/**
 * Calculates backoff delay in milliseconds for a given retry attempt.
 *
 * Handles 0-retry queue records gracefully by assigning the first backoff step (1m).
 * Returns `null` when the ladder's attempts (5, by default) have been exhausted.
 *
 * `ladder` defaults to `RETRY_BACKOFF_LADDER_MS` but is a parameter, not a hard-coded read of it,
 * so a caller governed by a DIFFERENT backoff sequence -- `driveTwelveMonthSimulation`'s contact
 * retry policy, whose ladder length also sets its own effective cap -- goes through this exact
 * function rather than a second copy of the same arithmetic. See `service-rules.ts`'s
 * `ContactRetryPolicy` for that caller.
 */
export function calculateRetryDelayMs(
  attemptCount: number,
  ladder: readonly number[] = RETRY_BACKOFF_LADDER_MS,
): number | null {
  if (!Number.isFinite(attemptCount) || attemptCount < 0) {
    return ladder[0] ?? null;
  }
  const index = Math.floor(attemptCount);
  if (index >= ladder.length) return null;
  return ladder[index];
}

/**
 * Calculates the next retry timestamp for a given attempt count.
 *
 * Prevents negative epoch or invalid date calculations. `ladder` is threaded through to
 * `calculateRetryDelayMs` unchanged -- see that function's note on why it is a parameter.
 */
export function calculateNextRetryTime(
  attemptCount: number,
  baseDate: Date = new Date(),
  ladder: readonly number[] = RETRY_BACKOFF_LADDER_MS,
): Date | null {
  const delayMs = calculateRetryDelayMs(attemptCount, ladder);
  if (delayMs === null) return null;
  const baseTime =
    baseDate instanceof Date && Number.isFinite(baseDate.getTime()) ? Math.max(0, baseDate.getTime()) : Date.now();
  return new Date(baseTime + delayMs);
}

/**
 * In-memory notification delivery retry queue.
 */
export class NotificationRetryQueue {
  private items = new Map<string, NotificationRetryItem>();

  /**
   * Enqueue a failed notification delivery for retry.
   */
  enqueue(params: EnqueueRetryParams): NotificationRetryItem {
    const safeNow = params.now instanceof Date && Number.isFinite(params.now.getTime()) ? params.now : new Date();
    const id = params.id ?? `retry-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const rawAttempt = params.attemptCount ?? 0;
    const attemptCount = Math.max(0, Number.isFinite(rawAttempt) ? Math.floor(rawAttempt) : 0);

    const isDeadLetter = attemptCount >= MAX_RETRY_ATTEMPTS;
    const nextRetryDate = isDeadLetter ? null : calculateNextRetryTime(attemptCount, safeNow);

    const item: NotificationRetryItem = {
      id,
      notificationId: params.notificationId,
      planId: params.planId,
      contactId: params.contactId,
      recipientId: params.recipientId,
      attemptCount,
      status: isDeadLetter ? "dead_letter" : "pending",
      createdAt: safeNow.toISOString(),
      nextRetryAt: nextRetryDate ? nextRetryDate.toISOString() : null,
      lastError: params.initialError,
    };

    this.items.set(id, item);
    return { ...item };
  }

  /**
   * Records a failed delivery attempt and schedules the next retry according to the backoff ladder.
   */
  recordFailure(id: string, error: string, now: Date = new Date()): NotificationRetryItem {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Retry item not found: ${id}`);
    }

    if (item.status === "completed") {
      throw new Error(`Cannot record failure on completed retry item: ${id}`);
    }

    if (item.status === "dead_letter" || item.attemptCount >= MAX_RETRY_ATTEMPTS) {
      const updated: NotificationRetryItem = {
        ...item,
        lastError: error,
        status: "dead_letter",
        nextRetryAt: null,
      };
      this.items.set(id, updated);
      return { ...updated };
    }

    const safeNow = now instanceof Date && Number.isFinite(now.getTime()) ? now : new Date();
    const createdTime = new Date(item.createdAt).getTime();
    // Clock drift guard: effective base time cannot drift earlier than item creation time
    const effectiveTime =
      Number.isFinite(createdTime) && safeNow.getTime() < createdTime ? new Date(createdTime) : safeNow;

    const nextAttempt = item.attemptCount + 1;
    const nextRetryDate = calculateNextRetryTime(nextAttempt, effectiveTime);

    const isDeadLetter = nextAttempt >= MAX_RETRY_ATTEMPTS || nextRetryDate === null;

    const updated: NotificationRetryItem = {
      ...item,
      attemptCount: nextAttempt,
      lastError: error,
      status: isDeadLetter ? "dead_letter" : "pending",
      nextRetryAt: nextRetryDate ? nextRetryDate.toISOString() : null,
    };

    this.items.set(id, updated);
    return { ...updated };
  }

  /**
   * Records successful delivery and completes the item.
   */
  recordSuccess(id: string, now: Date = new Date()): NotificationRetryItem {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Retry item not found: ${id}`);
    }

    const updated: NotificationRetryItem = {
      ...item,
      status: "completed",
      nextRetryAt: null,
      completedAt: now.toISOString(),
    };

    this.items.set(id, updated);
    return { ...updated };
  }

  /**
   * Retrieves all items that are pending and due for retry at or before `asOf`.
   */
  getPendingRetries(asOf: Date = new Date()): NotificationRetryItem[] {
    const asOfTime = asOf.getTime();
    const result: NotificationRetryItem[] = [];

    for (const item of this.items.values()) {
      if (item.status === "pending" && item.nextRetryAt !== null) {
        if (new Date(item.nextRetryAt).getTime() <= asOfTime) {
          result.push({ ...item });
        }
      }
    }

    return result;
  }

  getItem(id: string): NotificationRetryItem | undefined {
    const item = this.items.get(id);
    return item ? { ...item } : undefined;
  }

  getAllItems(): NotificationRetryItem[] {
    return Array.from(this.items.values()).map((item) => ({ ...item }));
  }

  clear(): void {
    this.items.clear();
  }
}
