// tests/helpers/caring-contacts-movable-clock.ts
//
// A clock a test can move forward, for the one rule in this domain that has to be exercised years
// later: identifying detail may be cleared only once the retention period (seven years, owner
// decision 2026-09-26) has passed since a plan ended. A store takes its clock at construction, so a
// test that ends a plan "now" and clears it "seven years later" needs one clock it can move.
import type { Clock } from "@/lib/caring-contacts/clock";

export type MovableClock = Clock & {
  /** Moves the clock to `iso`. */
  set(iso: string): void;
  /** Moves the clock forward by whole calendar years (UTC), far enough past any AWST boundary. */
  advanceYears(years: number): void;
};

export function movableClock(startIso: string): MovableClock {
  let instant = new Date(startIso);
  if (Number.isNaN(instant.getTime())) throw new Error(`movableClock: invalid instant ${startIso}`);
  return {
    now: () => new Date(instant.getTime()),
    set(iso: string) {
      const next = new Date(iso);
      if (Number.isNaN(next.getTime())) throw new Error(`movableClock: invalid instant ${iso}`);
      instant = next;
    },
    advanceYears(years: number) {
      const next = new Date(instant.getTime());
      next.setUTCFullYear(next.getUTCFullYear() + years);
      // One extra day, so the AWST calendar day is unambiguously past the anniversary.
      next.setUTCDate(next.getUTCDate() + 1);
      instant = next;
    },
  };
}
