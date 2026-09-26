// src/lib/caring-contacts/demo-clock.ts
//
// Controllable virtual time provider for demonstrating Caring Contacts workflows.
// Part of Phase 3 demonstrable capability (#4STSM1, spec §10.1).
//
// Pure domain provider: no UI imports, no ambient clock, deterministic AWST calendar arithmetic.

import { awstCalendarDay, awstCalendarDayOffset, awstWallTimeToInstant, toAwstParts, type Clock } from "./clock";
import { calendarDayPlusMonths } from "./schedule";

export class CaringContactsTimeProvider implements Clock {
  private readonly initialInstant: Date;
  private currentInstant: Date;

  constructor(initialTime?: Date | string) {
    if (typeof initialTime === "string") {
      const parsed = new Date(initialTime);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`CaringContactsTimeProvider: invalid initial instant ${initialTime}`);
      }
      this.initialInstant = parsed;
    } else if (initialTime instanceof Date) {
      this.initialInstant = new Date(initialTime.getTime());
    } else {
      this.initialInstant = new Date();
    }
    this.currentInstant = new Date(this.initialInstant.getTime());
  }

  /**
   * Current virtual instant implementing the Clock interface.
   */
  now(): Date {
    return new Date(this.currentInstant.getTime());
  }

  /**
   * The current virtual AWST calendar day (YYYY-MM-DD).
   */
  calendarDay(): string {
    return awstCalendarDay(this.currentInstant);
  }

  /**
   * Advance virtual time forward by a whole number of days.
   */
  advanceDays(days = 1): Date {
    const currentDay = this.calendarDay();
    const targetDay = awstCalendarDayOffset(currentDay, days);
    const { hour, minute } = toAwstParts(this.currentInstant);
    this.currentInstant = awstWallTimeToInstant(targetDay, hour, minute);
    return this.now();
  }

  /**
   * Advance virtual time forward by whole weeks.
   */
  advanceWeeks(weeks = 1): Date {
    return this.advanceDays(weeks * 7);
  }

  /**
   * Advance virtual time forward by whole calendar months using approved schedule arithmetic.
   */
  advanceMonths(months = 1): Date {
    const currentDay = this.calendarDay();
    const targetDay = calendarDayPlusMonths(currentDay, months);
    if (!targetDay) {
      throw new Error(`Invalid calendar day addition: ${currentDay} + ${months} months`);
    }
    const { hour, minute } = toAwstParts(this.currentInstant);
    this.currentInstant = awstWallTimeToInstant(targetDay, hour, minute);
    return this.now();
  }

  /**
   * Reset virtual time back to the provider's initial baseline instant.
   */
  reset(): Date {
    this.currentInstant = new Date(this.initialInstant.getTime());
    return this.now();
  }

  /**
   * Set virtual time directly to a specified instant.
   */
  setTime(instant: Date | string): Date {
    const parsed = typeof instant === "string" ? new Date(instant) : new Date(instant.getTime());
    if (Number.isNaN(parsed.getTime())) {
      throw new Error(`CaringContactsTimeProvider: invalid instant target`);
    }
    this.currentInstant = parsed;
    return this.now();
  }
}
