// PROVISIONAL — SERVICE OPERATING RULES, NOT CLINICAL CONTENT.
//
// Governed configuration for how the service behaves, as distinct from what it says (that is
// ./message-rules.ts) and from how long records are kept, which is a separate policy module that
// owns its own period and is deliberately not named from any sibling.
//
// Why this file exists: the twelve-month simulation (Task 10) needed a retry policy and no module
// owned one, so it was made a required caller input and the values lived in test fixtures. The
// decision lock states retries as a SERVICE rule, not a per-caller choice, and a rule that lives
// only in a test fixture is a rule nobody can find or change deliberately. It now has a home,
// a default, and an explicit override path.
//
// Replace the values here when the service owner changes the policy; do not restate them at a
// call site.
//
// #8K9W2B follow-up: the governed policy used to be its own flat interval (45 minutes, three
// attempts), invented for this file alone and never reconciled with the notification retry
// backoff ladder `./retry-queue` separately introduced. Two policies for one clinical action --
// "try to deliver this caring contact again" -- is exactly the drift Ruling 46 exists to prevent,
// so this is now the SAME ladder, imported rather than restated: `driveTwelveMonthSimulation`
// (`./simulation`, the one non-test consumer of this policy) computes each attempt's offset with
// `calculateRetryDelayMs` from `./retry-queue`, the identical function `NotificationRetryQueue`
// uses, so a change to the ladder changes both call sites from one edit.

import { MAX_RETRY_ATTEMPTS, RETRY_BACKOFF_LADDER_MS } from "./retry-queue";

/**
 * How many times one caring contact may be attempted, and how far apart.
 *
 * `maxAttempts` counts the FIRST attempt, so 5 means one send and four retries -- capped
 * independently of `backoffMs.length` so a caller can shorten the run (fewer attempts) without
 * inventing a shorter ladder.
 *
 * `backoffMs[i]` is the delay, in milliseconds, before attempt `i + 1` — the SAME indexing
 * `calculateRetryDelayMs` in `./retry-queue` uses, because attempt 1 is not sent the instant the
 * contact's `sendAt` arrives; it goes through the same 1-minute dispatch delay every other attempt
 * does. `backoffMs[0]` is therefore the gap between `sendAt` and attempt 1, `backoffMs[1]` between
 * attempt 1 and attempt 2, and so on.
 *
 * Retries never extend the send window. Whether an attempt is still allowed is decided by
 * `isWithinApprovedSendWindow` in ./schedule and by the contact's own AWST calendar day — a retry
 * that would roll past 18:00, or into the next day, does not happen, however many backoff steps
 * remain. This policy therefore sets how often and how many are OFFERED, never how late one may
 * land; the window is a separate, and senior, rule.
 */
export type ContactRetryPolicy = {
  /** Total attempts including the first, capped independently of `backoffMs.length`. */
  maxAttempts: number;
  /** Delay before each attempt, indexed from the first — see the type's own note above. */
  backoffMs: readonly number[];
};

/**
 * The notification retry backoff ladder (1m, 5m, 15m, 1h, 6h) and its 5-attempt cap, both read
 * from `./retry-queue` rather than restated: this IS that ladder, not a caring-contacts-flavoured
 * copy of it. A caring contact whose fifth attempt still fails is refused exactly as the
 * notification queue dead-letters a fifth failure -- `driveTwelveMonthSimulation` records it
 * `missed` rather than `dead_letter` because a missed clinical contact and an undelivered
 * notification are reported to different audiences, but the retry arithmetic behind both is now
 * one function, not two.
 */
export const DEFAULT_CONTACT_RETRY_POLICY: ContactRetryPolicy = Object.freeze({
  maxAttempts: MAX_RETRY_ATTEMPTS,
  backoffMs: RETRY_BACKOFF_LADDER_MS,
});
