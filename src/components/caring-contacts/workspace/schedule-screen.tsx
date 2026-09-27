import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import Link from "next/link";

import { CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM, patientRoute, scheduleDayRoute } from "@/lib/caring-contacts-routes";
import { awstCalendarDayOffset, toAwstParts } from "@/lib/caring-contacts/clock";
import type { ActorId, TeamId } from "@/lib/caring-contacts/ids";
import { TERMINAL_PLAN_STATES, type ContactState, type PlanState } from "@/lib/caring-contacts/model";
import { isAwstCalendarDay } from "@/lib/caring-contacts/schedule";
import type {
  PlanSendingHold,
  ScheduleCounts,
  ScheduleDay,
  ScheduleEntry,
  ScheduleGroup,
  ScheduleNotSendingReason,
  ScheduleRangeView,
} from "@/lib/caring-contacts/schedule-view";

import { AutomatedState } from "./automated-state";
import { ContactTimeAdjustment } from "./contact-time-adjustment";
import { CONTACT_STATE_LABELS, MESSAGE_TYPE_LABELS } from "./contact-vocabulary";
import { ListEmptyState } from "./list-empty-state";
import { WorkspaceOverlayTrigger } from "./overlays/overlay-trigger";
import { workspacePanelPadded } from "./surfaces";
import { plural } from "./count-wording";

/**
 * The Schedule screen -- what this team's caring-contact plans put on one AWST day, and what the
 * days either side of it hold.
 *
 * IT DERIVES NOTHING. Every fact rendered here comes off a `ScheduleRangeView` that
 * `schedule-view.ts` built: which of the three approved windows a contact sends in, whether its own
 * plan is holding it, whether it still goes out, why it will not, and whether it is a named
 * exception. This file chooses WORDS and LAYOUT for those facts and computes no schedule rule of
 * its own -- a screen that re-derived one would be free to go on grouping by a window the domain
 * had moved, on the surface that tells a coordinator what a discharged patient is about to receive.
 *
 * THE ONE THING IT MUST NOT DO IS COLLAPSE TWO DAYS INTO ONE. `disposition` alone cannot separate a
 * quiet day from a stopped one, and `nothingDue` covers three different days: one where everything
 * has already gone out, one where everything was stopped, and one where a plan nobody started is
 * holding the lot. A screen that rendered the disposition and stopped would show all three as "no
 * work today" -- and the third of those is a discharged patient receiving nothing while the record
 * looks complete. So the day's statement is derived from `counts`, which partition the day exactly:
 * with nothing due, `alreadySent + held + willNotBeSent` is the whole of it.
 *
 * A HELD PLAN IS NOT AN EXCEPTION AND IS NOT A QUIET DAY EITHER. Task 12 deliberately kept held
 * contacts out of the named-exceptions panel -- nothing failed, nothing is overdue, the plan was
 * never started -- and put `counts.held` and each entry's `planHold` on the wire so a screen could
 * still say so. The day-level notice `SelectedDay` renders from `distinctHoldsOf` is that, and it
 * appears whether or not anything on the day is due.
 *
 * NO PATIENT IDENTITY IS READ HERE, and that is a decision rather than an omission -- see the page.
 * A row is headed by the synthetic patient identifier and links to the patient record, which is the
 * screen that holds the name and is audited for it in its own right.
 *
 * A Server Component with no hooks and no client boundary (Ruling 13): the day being looked at
 * travels in the URL, every day control is a `<Link>`, and nothing on this screen needs JavaScript
 * to work. The accessible names below come from the strings the components already render rather
 * than from ids, because an id would need `useId` and `useId` is a hook.
 */

/** How many days the strip offers, and how many of them sit before the day being looked at. */
export const SCHEDULE_STRIP_DAYS = 7;
export const SCHEDULE_STRIP_DAYS_BEFORE = 3;

/**
 * Which AWST calendar day the URL asks for, or today when it asks for none.
 *
 * The one place a query value becomes a day -- never re-derived in a component. A repeated
 * `?day=a&day=b` arrives as an array and names no single day; an unrecognised or impossible value
 * (`2026-02-30`, which a `\d{4}-\d{2}-\d{2}` pattern would accept) is refused by the domain's own
 * `isAwstCalendarDay` rather than by a second copy of the format written here. Both fall back to
 * today rather than throwing: a mistyped URL must land a clinician on a real day, never on an error
 * page and never on a day nothing was read for.
 */
export function parseScheduleDay(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  todayCalendarDay: string,
): string {
  const raw = searchParams[CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM];
  return typeof raw === "string" && isAwstCalendarDay(raw) ? raw : todayCalendarDay;
}

/**
 * Whether the URL asked for a day this screen could not read, so the screen can say it is showing
 * today instead rather than silently doing so. A missing `?day=` is not a misunderstanding; an
 * empty, repeated or impossible one is. Decided by `parseScheduleDay`'s own rule, not a second copy.
 */
export function scheduleDayWasNotUnderstood(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): boolean {
  const raw = searchParams[CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM];
  if (raw === undefined) return false;
  return !(typeof raw === "string" && isAwstCalendarDay(raw));
}

const sectionId = "caring-contacts-schedule";

/**
 * Weekday and month names, written out rather than formatted by `Intl`.
 *
 * A screen's date wording has to be the same in a test, in CI and on the machine of whoever reads
 * it, and `Intl.DateTimeFormat` is none of those things: its output depends on the ICU data the
 * runtime was built with, down to whether a comma follows the weekday. These arrays are three lines
 * and cannot drift.
 */
const WEEKDAY_NAMES = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

const MONTH_NAMES = Object.freeze([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

function partsOfCalendarDay(calendarDay: string): { year: number; month: number; day: number; weekday: number } {
  const [year, month, day] = calendarDay.split("-").map(Number);
  return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "Monday 31 August 2026" -- the whole date, for the day being looked at. */
export function scheduleDayLabel(calendarDay: string): string {
  const { year, month, day, weekday } = partsOfCalendarDay(calendarDay);
  return `${WEEKDAY_NAMES[weekday]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * What a screen reader hears on one day of the strip, and it BEGINS with the words on the face of it.
 *
 * WCAG 2.5.3 Label in Name (level A): the visible label text must be contained in the accessible
 * name, so that somebody driving this by voice can address the control by what it shows. The strip
 * shows "Mon 31 Aug", a number, and "Today" on the day that is today; all three are here, in that
 * order, with the year and the unit words around them. An `aria-label` reading "Monday 31 August
 * 2026" instead met none of that -- the visible string appeared nowhere in the name.
 *
 * IT NAMES WHAT THE DAY HOLDS AND NOTHING ELSE. It also used to announce how many were still to
 * send, a number no sighted user can find anywhere in the strip. That is a divergence between two
 * readings of the same control rather than an enhancement for one of them, and the still-to-send
 * count is already on the day itself, in the readout above its windows, where both readings get it
 * at the same time.
 */
function stripDayAccessibleName(day: ScheduleDay, isToday: boolean): string {
  const [year] = day.calendarDay.split("-");
  return `${stripDayLabel(day.calendarDay)} ${year}${isToday ? ", Today" : ""}. ${plural(day.counts.total, "contact", "contacts")}.`;
}

/** "Mon 31 Aug" -- one day of the strip, where the whole date does not fit. */
function stripDayLabel(calendarDay: string): string {
  const { month, day, weekday } = partsOfCalendarDay(calendarDay);
  return `${WEEKDAY_NAMES[weekday].slice(0, 3)} ${day} ${MONTH_NAMES[month - 1].slice(0, 3)}`;
}

/**
 * The AWST wall-clock time an instant sends at, in the shape `./schedule`'s window `sendTime`
 * already uses.
 *
 * Needed only for a contact that sends at no approved time -- the three windows publish their own
 * `sendTime`, and this screen renders those rather than recomputing them. This formats an instant;
 * it decides nothing about which times are approved.
 */
function awstClockLabel(instant: Date): string {
  const { hour, minute } = toAwstParts(instant);
  const suffix = hour < 12 ? "am" : "pm";
  const twelveHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelveHour}:${String(minute).padStart(2, "0")} ${suffix} AWST`;
}

/** Plain words for what a plan's own state is doing to its contacts. */
const PLAN_HOLD_LABELS: Readonly<Record<PlanSendingHold, string>> = Object.freeze({
  planNotStarted: "Plan not started",
  planPaused: "Plan paused",
  planEnded: "Plan ended",
});

/**
 * Why a plan is holding its contacts, and what would change it.
 *
 * An exhaustive switch rather than a lookup with a fallback, for the same reason the domain's own
 * classifications are: a fourth hold added later and left unworded here must not compile into a
 * silent blank on a screen that says what the service will and will not send.
 *
 * `planNotStarted` is the one that matters most. A plan created and never started is a completed
 * sign-up that nobody finished -- the record looks whole and the patient hears nothing -- so its
 * wording says what is happening rather than only what the plan's state is called.
 */
function planHoldExplanation(hold: PlanSendingHold): { because: string; changedBy: string } {
  switch (hold) {
    case "planNotStarted":
      return {
        because:
          "A plan on this day was created and never started. Its schedule says a message falls here, and nothing will be sent for it, so a patient who has been discharged is receiving nothing while the plan record looks complete.",
        changedBy:
          "Starting the plan, from that patient's record, puts its remaining contacts back into the sending windows.",
      };
    case "planPaused":
      return {
        because:
          "A plan on this day is paused. A coordinator stopped it deliberately, so nothing is sent for it while the pause stands, and its contacts stay in the schedule rather than being cancelled.",
        changedBy: "Resuming the plan, from that patient's record, puts its remaining contacts back into the windows.",
      };
    case "planEnded":
      return {
        because:
          "A plan on this day has ended. Its remaining contacts are still in the schedule and none of them is sent.",
        changedBy: "Nothing here. An ended plan is not restarted; that patient's record holds how it ended.",
      };
    default: {
      const unclassified: never = hold;
      return unclassified;
    }
  }
}

/**
 * Why one contact will not be sent, and what would change it.
 *
 * Exhaustive for the same reason. `absorbedByFirstContact` is the only one of the four with a
 * remedy: the plan is working exactly as designed and the coordinator can undo it by choosing a
 * different first-contact date. The other three are terminal and say so rather than inventing a
 * control.
 */
function notSendingExplanation(
  reason: ScheduleNotSendingReason,
  planState: PlanState,
): {
  state: string;
  because: string;
  changedBy: string;
} {
  switch (reason) {
    case "absorbedByFirstContact":
      return {
        state: "Suppressed",
        because:
          "This plan's first contact falls on the same calendar day as its Week 1 message, and two caring contacts must never land on one day, so the schedule kept one of them.",
        changedBy: TERMINAL_PLAN_STATES.includes(planState)
          ? "Nothing here. This plan has ended, so its first-contact date can no longer be changed and it sends no further messages."
          : "Choosing a different first-contact date for this plan puts the Week 1 message back.",
      };
    case "suppressed":
      return {
        state: "Suppressed",
        because: "The system marked this message suppressed, and this screen does not hold what caused that.",
        changedBy: TERMINAL_PLAN_STATES.includes(planState)
          ? "Nothing here. A suppressed message is final and is never sent later, and this plan has ended, so it sends no further messages."
          : "Nothing here. A suppressed message is final and is never sent later; the plan continues with the messages that remain.",
      };
    case "cancelled":
      return {
        state: "Cancelled",
        because: "This message was cancelled, so it is not sent on this day or on any later one.",
        changedBy:
          "Nothing here. A cancelled message is never sent later; that patient's record holds what happened to the plan.",
      };
    case "missed":
      return {
        state: "Missed",
        because: "The sending window closed before this message went out, and a missed message is never retried.",
        changedBy:
          "Nothing here, and nothing is sent later. It is listed as a named exception so a coordinator can decide what to do instead.",
      };
    default: {
      const unclassified: never = reason;
      return unclassified;
    }
  }
}

/**
 * WHAT THIS SCREEN HOLDS ABOUT A DELIVERY THAT DID NOT ARRIVE, AND WHAT IT DOES NOT.
 *
 * Phase 2B Task 14, and the honesty this whole panel turns on. Four of the five named-exception
 * states are PROVIDER OUTCOMES: the message left, and the phone network reported what became of it.
 * Each is a transport receipt and none of them is a statement about the patient -- so the wording
 * below says how the message travelled and stops there.
 *
 * NOTHING HERE COUNTS ATTEMPTS, AND THE RECORD DOES NOT EITHER. `resolve-failed-delivery`'s frozen
 * summary speaks of "all three attempts in the original window", which describes a delivery history
 * this service does not keep: it records the outcome of a single sending attempt for a contact, and
 * no method anywhere in the repository contract dispatches a contact again -- `startProcessing`
 * accepts only a `scheduled` contact, and a contact carrying a provider outcome is not one. The
 * design is a picture of a later, integrated product; the types are what exists. Where they
 * disagree, the types win, and the disagreement is recorded rather than resolved quietly (Task 14
 * report). So no sentence on this screen implies that anything was tried more than once.
 *
 * `missed` is deliberately NOT answered here. It is a named exception too, but it is the one that
 * never reached the provider at all, and `notSendingExplanation` above already states it -- two
 * statements on one row would be the same fact told twice, in different words.
 *
 * Exhaustive over the whole of `ContactState` rather than over the four, for the reason every other
 * classification in this workspace is: a state added later and left unworded must not compile into
 * a silent blank on the panel that says which patients did not hear from the service.
 */
function deliveryExceptionExplanation(state: ContactState): { because: string; changedBy: string } | null {
  const notTriedAgain =
    "Nothing here, and nothing is sent later: this service has no way to send a caring contact again. What is done instead is a decision a person makes, and it is recorded away from this screen.";
  switch (state) {
    case "notDelivered":
      return {
        because:
          "The message provider reported that this message was not delivered. That report is the whole of what is held about it -- how it travelled, and nothing about whether it was read or whether it helped.",
        changedBy: notTriedAgain,
      };
    case "numberInvalid":
      return {
        because:
          "The message provider reported that the mobile number it was sent to is not a working number, so the message did not arrive.",
        changedBy: notTriedAgain,
      };
    case "contactChanged":
      return {
        because:
          "The message provider reported that the mobile number it was sent to has changed. A changed number is checked by a person before anything else is sent to it.",
        changedBy: notTriedAgain,
      };
    case "statusUnavailable":
      return {
        because:
          "The message left and no transport receipt ever came back for it, so what became of it is not known. That is different from being told it failed: nothing was reported either way.",
        changedBy: notTriedAgain,
      };
    // Not a provider outcome, or not an exception at all. `missed` is stated by
    // `notSendingExplanation`; the rest are routine states that need no statement here.
    case "missed":
    case "scheduled":
    case "processing":
    case "sent":
    case "delivered":
    case "suppressed":
    case "cancelled":
      return null;
    default: {
      const unclassified: never = state;
      return unclassified;
    }
  }
}

/**
 * Why "Record what was done" cannot be recorded from this screen, in the words the overlay renders.
 *
 * THIS SENTENCE IS ALSO WHERE THE OVERLAY'S OWN COPY IS CORRECTED, and that placement is deliberate.
 * The row's frozen summary -- rendered by the shared host, transcribed from the frozen matrix, and
 * not this screen's to edit -- opens by saying all three attempts are finished. A clinician reading
 * that sentence must not be left with it, and the refusal below is the only text this screen puts on
 * the same surface.
 *
 * The rest of it is the gap itself, stated plainly rather than worked around. `resolveDispatchDiscrepancy`
 * is keyed by a contact AND an attempt number; a schedule is built from plans and reads no dispatch
 * record at all; and the one read that returns those records is a search over the instant a SEND
 * BEGAN, which is a different instant from the one a contact is scheduled for. Joining the two by day
 * would be relying on a coincidence this domain does not guarantee, and a resolution recorded against
 * the wrong attempt is not an acceptable way to be wrong on this panel. Closing that needs a
 * by-contact read on the repository contract, which is a contract change with its own review.
 */
const RESOLVE_FAILED_DELIVERY_UNAVAILABLE =
  "Nothing can be recorded here, and one thing this overlay says needs correcting first: this service does not keep a history of sending attempts. It records the outcome of a single attempt for a contact and has no way to send another, so there is no set of attempts to close off. What was done instead is kept against the dispatch record for this contact, and a schedule is built from plans and never reads one.";

/**
 * What the day's numbers say, in words, when nothing on it is due.
 *
 * `alreadySent`, `held` and `willNotBeSent` PARTITION a day with nothing due -- `total` is their
 * sum, because `stillToSend` splits into `due` and `held` and `due` is zero here. So this covers
 * every such day without a fallback clause, and each part is named only when it is actually
 * present. The "every"/"some" distinction is derived from the same counts rather than assumed.
 *
 * Ruling 94: no number appears in this prose. The numbers themselves are rendered as a data
 * readout directly above the lists they count, where they cannot decay away from what they describe.
 */
/**
 * Provider receipts that say the message did not arrive. "Sent" is not true of a day holding one of
 * these, so the day's statement says "attempted" and names the failure instead.
 */
const NOT_DELIVERED_STATES: ReadonlySet<ContactState> = new Set<ContactState>(["notDelivered", "numberInvalid"]);

function dayHasUndeliveredContact(day: ScheduleDay): boolean {
  return [...day.windows, day.outsideApprovedWindows, day.exceptions].some((group) =>
    group.entries.some((entry) => NOT_DELIVERED_STATES.has(entry.state)),
  );
}

function quietDayClauses(counts: ScheduleCounts, anyNotDelivered = false): string[] {
  const clauses: string[] = [];
  if (counts.alreadySent > 0) {
    clauses.push(
      anyNotDelivered
        ? counts.alreadySent === counts.total
          ? "Every contact on this day has been attempted; one or more was not delivered."
          : "Some have already been attempted; one or more was not delivered."
        : counts.alreadySent === counts.total
          ? "Every contact on this day has already been sent."
          : "Some have already been sent.",
    );
  }
  if (counts.held > 0) {
    clauses.push(
      counts.held === counts.total
        ? "Every contact on this day belongs to a plan that is not sending."
        : "Some belong to a plan that is not sending.",
    );
  }
  if (counts.willNotBeSent > 0) {
    clauses.push(
      counts.willNotBeSent === counts.total
        ? "No contact on this day will be sent at all."
        : "Some will not be sent at all.",
    );
  }
  return clauses;
}

/** The day's statement, which must read differently for each of the days `nothingDue` covers. */
function dayStatement(day: ScheduleDay): string {
  const clauses =
    day.disposition === "contactsDue"
      ? ["Contacts still to go out on this day are grouped below by the window they send in."]
      : ["Nothing on this day is waiting to go out.", ...quietDayClauses(day.counts, dayHasUndeliveredContact(day))];
  if (day.counts.needsReview > 0) {
    clauses.push("Named exceptions are listed separately below, out of their sending window.");
  }
  return clauses.join(" ");
}

/**
 * Who is acting, carried down to the one control on this screen that writes.
 *
 * ONE OBJECT RATHER THAN THREE PROPS THREADED THROUGH FIVE COMPONENTS. The alternative is the same
 * three values repeated on every intermediate signature, where the next component added to the chain
 * forgets one and a control silently loses its permission gate.
 *
 * It carries no patient data and no name: an actor id, a team id, and one answer about a capability
 * the page asked the sealed domain for.
 */
export type ScheduleActingContext = {
  actorId: ActorId;
  teamId: TeamId;
  /** False when the acting role is not granted the action that moves a contact. Decided by the page. */
  mayMoveContactWithinDay: boolean;
};

export type ScheduleScreenProps = {
  /**
   * The whole day strip, from ONE `buildScheduleRange` call. The selected day is one of these days
   * rather than a second read, so the strip and the day open below it can never disagree.
   */
  view: ScheduleRangeView;
  /** Which day of `view.days` is open. */
  selectedCalendarDay: string;
  /** Today in AWST, resolved by the page from the server's clock -- this component holds no clock. */
  todayCalendarDay: string;
  /** False when the acting role does not include viewing plans. Decided by the page, from the actor. */
  mayViewPlans: boolean;
  /** Who is acting, for the one control on this screen that writes. */
  acting: ScheduleActingContext;
  /** True when the URL named a day that could not be read, so today is shown instead. */
  dayNotUnderstood?: boolean;
};

export function ScheduleScreen({
  view,
  selectedCalendarDay,
  todayCalendarDay,
  mayViewPlans,
  acting,
  dayNotUnderstood = false,
}: ScheduleScreenProps) {
  const selected = view.days.find((day) => day.calendarDay === selectedCalendarDay) ?? null;

  return (
    <section aria-labelledby={`${sectionId}-heading`} className="min-w-0">
      <h2 id={`${sectionId}-heading`} className="text-base font-semibold text-[color:var(--text-heading)]">
        Contacts due, day by day
      </h2>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        What this team&rsquo;s caring-contact plans put on one day, grouped by the approved sending windows. Every
        patient here is invented and nothing on this screen is ever sent to a real number.
      </p>
      {dayNotUnderstood ? (
        <p
          role="status"
          data-testid="caring-contacts-schedule-day-not-understood"
          className="mt-3 max-w-[var(--measure)] rounded-[var(--radius-md)] border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-3 py-2 text-sm leading-6 text-[color:var(--warning-text)]"
        >
          The date in the link was not understood, so today is shown instead.
        </p>
      ) : null}

      {!mayViewPlans ? (
        <div className="mt-5 min-w-0">
          <ListEmptyState
            kind="not-permitted"
            heading="The schedule is not visible in this role"
            because="Viewing plans is not part of the role you are acting in, and a schedule is built entirely from this team's plans. This says nothing about how many contacts fall on any day: a read you may not make and a day with nothing on it look identical on purpose, so that nobody can find out a record exists by being refused it."
            changedBy="Nothing on this screen changes it, and there is no control for it anywhere in this workspace yet. The role this demonstration acts in is set outside the interface; a coordinator sees this team's schedule."
          />
        </div>
      ) : selected === null ? (
        // Unreachable while the page picks the selected day from inside the range it asked for, and
        // stated rather than left to render nothing: an empty screen is the one outcome that would
        // read as "no contacts on this day", which is a claim nothing here has made.
        <div className="mt-5 min-w-0">
          <ListEmptyState
            kind="no-data"
            heading="This day was not read"
            explanation="The schedule was read for a range that does not contain the day asked for, so nothing about that day is known here. Choosing a day in the strip above reads it."
          />
        </div>
      ) : (
        <>
          <WeekControls selectedCalendarDay={selectedCalendarDay} />
          <DayStrip view={view} selectedCalendarDay={selectedCalendarDay} todayCalendarDay={todayCalendarDay} />
          <SelectedDay day={selected} view={view} todayCalendarDay={todayCalendarDay} acting={acting} />
        </>
      )}
    </section>
  );
}

const weekControlClass =
  "inline-flex min-h-tap min-w-0 items-center gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm font-medium text-[color:var(--text)] hover:bg-[color:var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]";

/** A week back and a week forward from the day being looked at, so a far date is not a day-by-day walk. */
function WeekControls({ selectedCalendarDay }: { selectedCalendarDay: string }) {
  return (
    <div className="mt-5 flex min-w-0 flex-wrap items-center justify-between gap-2">
      <Link
        href={scheduleDayRoute(awstCalendarDayOffset(selectedCalendarDay, -7))}
        data-internal-link="true"
        data-testid="caring-contacts-schedule-previous-week"
        className={weekControlClass}
      >
        <ChevronLeft aria-hidden="true" className="size-icon-sm shrink-0" />
        <span>Previous week</span>
      </Link>
      <Link
        href={scheduleDayRoute(awstCalendarDayOffset(selectedCalendarDay, 7))}
        data-internal-link="true"
        data-testid="caring-contacts-schedule-next-week"
        className={weekControlClass}
      >
        <span>Next week</span>
        <ChevronRight aria-hidden="true" className="size-icon-sm shrink-0" />
      </Link>
    </div>
  );
}

/**
 * The days either side of the one being looked at, each a link.
 *
 * Each day carries what it HOLDS, not only what is due on it. A strip that showed `due` alone would
 * put a zero on a day whose every contact is a named exception or is held by a plan nobody started
 * -- the exact collapse this screen exists to prevent, moved one level up into the navigation.
 */
function DayStrip({
  view,
  selectedCalendarDay,
  todayCalendarDay,
}: {
  view: ScheduleRangeView;
  selectedCalendarDay: string;
  todayCalendarDay: string;
}) {
  return (
    <nav aria-label="Choose a day" className="mt-3 grid min-w-0 grid-cols-4 gap-2 sm:grid-cols-7">
      {view.days.map((day) => {
        const current = day.calendarDay === selectedCalendarDay;
        return (
          <Link
            key={day.calendarDay}
            href={scheduleDayRoute(day.calendarDay)}
            data-internal-link="true"
            data-schedule-day={day.calendarDay}
            aria-current={current ? "page" : undefined}
            className="flex min-h-tap min-w-0 flex-col items-center justify-center gap-0.5 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-1 py-2 text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] aria-[current]:border-[color:var(--clinical-accent)] aria-[current]:bg-[color:var(--clinical-accent-soft)] aria-[current]:font-semibold aria-[current]:text-[color:var(--clinical-accent)] aria-[current]:shadow-[var(--shadow-inset)] forced-colors:border-[CanvasText]"
          >
            <span aria-hidden="true" className="block truncate text-2xs font-medium text-[color:var(--text-muted)]">
              {stripDayLabel(day.calendarDay)}
            </span>
            <span
              aria-hidden="true"
              className="block text-sm font-semibold tabular-nums text-[color:var(--text-heading)]"
            >
              {day.counts.total}
            </span>
            {day.calendarDay === todayCalendarDay ? (
              <span aria-hidden="true" className="block text-3xs font-medium text-[color:var(--clinical-accent)]">
                Today
              </span>
            ) : null}
            {/*
              The accessible name, and the ONLY thing in this control that is not `aria-hidden` --
              so the name is this string rather than a competing `aria-label`. See
              `stripDayAccessibleName` for why it begins with the words on the face of the control.
            */}
            <span className="sr-only">{stripDayAccessibleName(day, day.calendarDay === todayCalendarDay)}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function SelectedDay({
  day,
  view,
  todayCalendarDay,
  acting,
}: {
  day: ScheduleDay;
  view: ScheduleRangeView;
  todayCalendarDay: string;
  acting: ScheduleActingContext;
}) {
  const heldHolds = distinctHoldsOf(day);

  return (
    <div className="mt-6 min-w-0">
      <h3 className="text-sm font-semibold text-[color:var(--text-heading)]">
        {scheduleDayLabel(day.calendarDay)}
        {day.calendarDay === todayCalendarDay ? " (today)" : ""}
      </h3>

      {day.counts.total === 0 ? (
        <div className="mt-4 min-w-0">
          <EmptyDay day={day} view={view} />
        </div>
      ) : (
        <>
          <p
            data-testid="caring-contacts-schedule-day-statement"
            className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
          >
            {dayStatement(day)}
          </p>

          <DayCounts counts={day.counts} />

          {heldHolds.length > 0 ? (
            <div className="mt-4 flex min-w-0 flex-col gap-3">
              {heldHolds.map((hold) => {
                const explanation = planHoldExplanation(hold);
                return (
                  <AutomatedState
                    key={hold}
                    state={PLAN_HOLD_LABELS[hold]}
                    because={explanation.because}
                    changedBy={explanation.changedBy}
                  />
                );
              })}
            </div>
          ) : null}

          {/*
            The three sending windows go 1-up, then 2-up, then 3-up — and the 3-up waits for
            1440px rather than arriving at `lg:`.

            This was `lg:grid-cols-3`, which put three columns on screen at 1024px. At that width
            the content column was 384px (the shell's old two-column grid), so each window was
            117px and each contact row inside it ~61px after `WindowColumn`'s `px-4` and
            `ContactRow`'s `px-3` — for "Sends at: 9:00 am AWST", a state line and two controls.
            Freeing the content column fixes most of that (704px at 1024, so 213px per window),
            but three windows still only earn their keep once each can hold a contact row
            comfortably. 2-up from `md:` gives ≥248px of content per window at every width from
            768 up; 3-up at 1440 gives ~347px.

            A raw `min-[1440px]:` rather than a named breakpoint: design-system GATES §3b forbids a
            sixth `--breakpoint-*` token, and the shell already spells this width the same way.
          */}
          <div className="mt-5 grid min-w-0 gap-4 md:grid-cols-2 min-[1440px]:grid-cols-3">
            {day.windows.map((window) => (
              <WindowColumn
                key={window.preference}
                heading={window.label}
                sendTime={window.sendTime}
                group={window}
                acting={acting}
                emptyText="Nothing sends in this window on this day."
              />
            ))}
          </div>

          {day.outsideApprovedWindows.entries.length > 0 ? (
            <OutsideApprovedWindows group={day.outsideApprovedWindows} acting={acting} />
          ) : null}

          <NamedExceptions group={day.exceptions} acting={acting} />
        </>
      )}
    </div>
  );
}

/**
 * Every distinct plan hold acting on this day, in a fixed order.
 *
 * Read off the entries the day already carries rather than off `counts.held`, because the count
 * says how many are held and not by WHAT -- and a coordinator's next move differs completely
 * between a plan nobody started and a plan somebody paused. Only entries that would otherwise go
 * out are considered: `planHold` is reported on a sent contact too, and telling a reader that an
 * ended plan is holding a message it already sent would be false.
 */
function distinctHoldsOf(day: ScheduleDay): PlanSendingHold[] {
  const present = new Set<PlanSendingHold>();
  for (const entry of allEntriesOf(day)) {
    if (entry.sendability === "stillToSend" && entry.planHold !== null) present.add(entry.planHold);
  }
  return (Object.keys(PLAN_HOLD_LABELS) as PlanSendingHold[]).filter((hold) => present.has(hold));
}

/** Every entry the day holds, in whichever group it landed in. */
function allEntriesOf(day: ScheduleDay): ScheduleEntry[] {
  return [
    ...day.windows.flatMap((window) => window.entries),
    ...day.outsideApprovedWindows.entries,
    ...day.exceptions.entries,
  ];
}

/**
 * What the day holds, as numbers, directly above the lists those numbers count.
 *
 * The first four rows PARTITION the day: due, held, already sent and will-not-be-sent add up to the
 * total, because `summariseStoredContacts` splits a day into sent / still-to-send / never and
 * `schedule-view.ts` splits still-to-send into due and held. Named exceptions cut ACROSS that
 * partition -- a missed contact will not be sent and a contact whose transport receipt never
 * arrived has already been sent, and both are exceptions -- so that row is separated from the four
 * and labelled as the panel it matches rather than as another part of the split.
 */
function DayCounts({ counts }: { counts: ScheduleCounts }) {
  const partition: readonly [string, number][] = [
    ["Due to send", counts.due],
    ["Held by their plan", counts.held],
    ["Already sent", counts.alreadySent],
    ["Will not be sent", counts.willNotBeSent],
  ];

  return (
    <dl
      data-testid="caring-contacts-schedule-day-counts"
      className="mt-4 grid min-w-0 grid-cols-2 gap-3 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 py-3 sm:grid-cols-3 forced-colors:border-[CanvasText]"
    >
      <div className="min-w-0">
        <dt className="text-xs font-medium text-[color:var(--text-muted)]">On this day</dt>
        <dd className="text-sm font-semibold tabular-nums text-[color:var(--text-heading)]">{counts.total}</dd>
      </div>
      {partition.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs font-medium text-[color:var(--text-muted)]">{label}</dt>
          <dd className="text-sm font-semibold tabular-nums text-[color:var(--text-heading)]">{value}</dd>
        </div>
      ))}
      <div className="min-w-0">
        <dt className="text-xs font-medium text-[color:var(--text-muted)]">Named exceptions</dt>
        <dd className="text-sm font-semibold tabular-nums text-[color:var(--text-heading)]">{counts.needsReview}</dd>
      </div>
    </dl>
  );
}

/**
 * The two ways a day can hold nothing, which read as different facts.
 *
 * A day with nothing on it while other days in the strip do hold contacts is the day CHOICE hiding
 * the work, and the remedy is the strip itself -- a control that exists, directly above (Ruling 93).
 * A strip with nothing anywhere in it is the other fact entirely, and offering "try another day"
 * there would send a clinician hunting through days that are all empty.
 */
function EmptyDay({ day, view }: { day: ScheduleDay; view: ScheduleRangeView }) {
  const elsewhere = view.days.filter((other) => other.calendarDay !== day.calendarDay && other.counts.total > 0);

  if (elsewhere.length === 0) {
    return (
      <ListEmptyState
        kind="no-data"
        heading="No contacts in these days"
        explanation="This team's plans put no caring contact on any of the days above. A day fills once a coordinator starts a plan whose schedule reaches it."
      />
    );
  }

  return (
    <ListEmptyState
      kind="filtered"
      heading="Nothing is scheduled on this day"
      because={`You are looking at ${scheduleDayLabel(day.calendarDay)}, and this team's plans put no caring contact on it. Other days above do hold contacts.`}
      changedBy="Choosing another day in the strip above opens it."
      action={
        <Link
          href={scheduleDayRoute(elsewhere[0].calendarDay)}
          data-internal-link="true"
          className="inline-flex min-h-tap shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]"
        >
          <span className="truncate">Open {scheduleDayLabel(elsewhere[0].calendarDay)}</span>
        </Link>
      }
    />
  );
}

/** One of the three approved sending windows, with the wording and send time the domain publishes. */
function WindowColumn({
  heading,
  sendTime,
  group,
  acting,
  emptyText,
  description,
  icon: Icon = Clock,
}: {
  heading: string;
  sendTime: string;
  group: ScheduleGroup;
  acting: ScheduleActingContext;
  emptyText: string;
  description?: string;
  icon?: typeof Clock;
}) {
  return (
    <section aria-label={heading} className={workspacePanelPadded}>
      <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <Icon aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0 truncate">{heading}</span>
      </h4>
      <p className="mt-0.5 text-xs text-[color:var(--text-muted)]">{sendTime}</p>
      {description ? (
        <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">{description}</p>
      ) : null}
      {group.entries.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[color:var(--text-muted)]">{emptyText}</p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-col gap-3">
          {group.entries.map((entry) => (
            <ContactRow key={entry.contactId} entry={entry} acting={acting} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Ruling [126] -- contacts sitting at a time none of the three named windows covers.
 *
 * NAMED BY THEIR TIME, NEVER AS "MOVED". A deliberate move is the only way to reach an off-window
 * time, but the converse is false and that is the whole point: a morning plan's contact moved to
 * 2:00 pm lands silently inside the afternoon window, because nothing in the record says a move
 * happened. Calling this group "moved" would therefore be true of everything in it and would miss
 * every moved contact that landed on an approved hour -- a label claiming more than the system can
 * attest. It also does not invent a fourth window: adding a sending window to a suicide-prevention
 * schedule by implementation accident is exactly what Task 12 refused to do.
 *
 * AND IT CLAIMS NO CONTAINMENT EITHER, which is the same error class caught one sentence later.
 * This copy used to say these contacts "sit inside the approved 9:00 am to 6:00 pm AWST sending
 * window". `sendingPreferenceAt` does not test that bound at all -- it answers null for ANY instant
 * that is not exactly one of the three send hours at minute zero -- so this group admits times
 * outside 09:00-18:00, and the suite's own defensive midnight contact is one. The planner cannot
 * currently produce such a contact, which is precisely what would have kept the sentence false and
 * unread. It now says only what the grouping actually establishes: not at any of the three times.
 */
function OutsideApprovedWindows({ group, acting }: { group: ScheduleGroup; acting: ScheduleActingContext }) {
  return (
    <div className="mt-5 min-w-0">
      <WindowColumn
        heading="Not at an approved send time"
        sendTime="Each contact is shown at the time it sends"
        description="These contacts send at a time none of the three windows above covers. They are listed here rather than filed under a window they do not send in."
        group={group}
        acting={acting}
        emptyText="No contact on this day sends outside the three windows."
        icon={CalendarDays}
      />
    </div>
  );
}

/**
 * The named-exceptions panel.
 *
 * Its contents are Task 12's definition -- the four provider outcomes that are not a delivery, plus
 * a contact the window closed on -- classified there by an exhaustive switch so nothing can default
 * in. That definition is stated in its report as a judgement rather than a rule the domain held,
 * and this screen renders it rather than re-deciding it.
 *
 * An empty panel says what it means. "No named exceptions" on a day whose contacts were all
 * cancelled is true and would be read as reassurance, so the empty wording points back at the day's
 * own statement instead of standing alone.
 */
function NamedExceptions({ group, acting }: { group: ScheduleGroup; acting: ScheduleActingContext }) {
  return (
    <section aria-label="Named exceptions" className={`${workspacePanelPadded} mt-5`}>
      <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <AlertTriangle aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">Named exceptions</span>
      </h4>
      <p className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        Contacts a person has to look at: a message the provider did not deliver, and a message the sending window
        closed on. They are kept out of the windows above so one patient is never counted twice.
      </p>
      {/*
        WHAT IS NOT RECORDED, SAID ONCE, WHERE THE PANEL IS READ.

        Ruling 94's test applies to this sentence and it passes: there is no tally here of anything
        listed below it. What it states is the shape of the record -- a single sending attempt per
        contact, and no way to send another -- which is the invariant, not a count of a list.

        It is here because the design this panel comes from describes a delivery history the service
        does not keep, and a coordinator reading a failed delivery would otherwise be entitled to
        assume an attempt count exists somewhere. See `deliveryExceptionExplanation` above.
      */}
      <p
        data-testid="caring-contacts-schedule-attempts-not-recorded"
        className="mt-2 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
      >
        What this screen does not hold: a history of sending attempts. This service records the outcome of a single
        attempt for a contact and has no way to send another, so there is no attempt history anywhere to show here.
      </p>
      {group.entries.length === 0 ? (
        <p className="mt-3 text-sm leading-6 text-[color:var(--text-muted)]">
          Nothing on this day needs a decision. That is not the same as nothing happening on it &mdash; what the day
          holds is stated above.
        </p>
      ) : (
        <ul className="mt-3 flex min-w-0 flex-col gap-3">
          {group.entries.map((entry) => (
            <ContactRow key={entry.contactId} entry={entry} acting={acting} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * One contact, on one day.
 *
 * Headed by the synthetic patient identifier, which is what this read releases, and linked to the
 * patient record, which is the screen that holds the name and is audited for reading it.
 *
 * Spec §4.4: a state the system reached on its own states, in place, why and what would change it.
 * Two scopes of that are possible on this row and they are answered in different places. Why THIS
 * contact will not be sent is a fact about the contact and is stated here. Why its PLAN is holding
 * it is a fact about the plan, whose remedy is on the plan, and is stated once for the day above --
 * so the row names the hold and points at it rather than repeating the whole explanation per row.
 */
function ContactRow({ entry, acting }: { entry: ScheduleEntry; acting: ScheduleActingContext }) {
  const notSending =
    entry.notSendingReason === null ? null : notSendingExplanation(entry.notSendingReason, entry.planState);
  const held = entry.sendability === "stillToSend" && entry.planHold !== null ? entry.planHold : null;
  const deliveryException = entry.needsReview ? deliveryExceptionExplanation(entry.state) : null;
  /*
    ONLY A CONTACT THAT HAS NOT GONE OUT CAN BE MOVED, and the test is the domain's own answer rather
    than a list of states written here. `contactSendability` already decided; a contact that has been
    sent, or that never will be, has no time left to change, and offering a control for one would be
    a control advertising an action the system does not perform.

    A HELD CONTACT STILL OFFERS IT. `rescheduleContact` does not gate on the plan's state, so a
    coordinator can set the time a paused plan's contact would send at if it resumes -- and the day
    already states, above, that the plan is holding it.
  */
  const mayMove = acting.mayMoveContactWithinDay && entry.sendability === "stillToSend";

  return (
    <li className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-3 forced-colors:border-[CanvasText]">
      <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--text-muted)]">
        Synthetic patient identifier
      </p>
      <h5 className="mt-0.5 truncate text-sm font-semibold text-[color:var(--text-heading)]">{entry.patientId}</h5>
      <p className="mt-1 text-sm leading-6 text-[color:var(--text-muted)]">
        {MESSAGE_TYPE_LABELS[entry.messageType]} &middot; {entry.cadenceLabel}
      </p>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Sends at: </span>
        {awstClockLabel(entry.sendAt)}
      </p>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">State: </span>
        {CONTACT_STATE_LABELS[entry.state]}
      </p>
      {held === null ? null : (
        <p className="text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Not sending: </span>
          {PLAN_HOLD_LABELS[held]} &mdash; stated in full above this day&rsquo;s windows.
        </p>
      )}
      <Link
        href={patientRoute(entry.patientId)}
        data-internal-link="true"
        className="mt-2 inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-4 text-sm font-medium text-[color:var(--text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]"
      >
        <span className="truncate">Patient record &mdash; {entry.patientId}</span>
      </Link>
      {notSending === null ? null : (
        <div className="mt-3 min-w-0">
          <AutomatedState state={notSending.state} because={notSending.because} changedBy={notSending.changedBy} />
        </div>
      )}
      {deliveryException === null ? null : (
        <div className="mt-3 min-w-0">
          <AutomatedState
            state={CONTACT_STATE_LABELS[entry.state]}
            because={deliveryException.because}
            changedBy={deliveryException.changedBy}
          />
          {/*
            The overlay's own refusal carries the correction to its frozen summary -- see
            `RESOLVE_FAILED_DELIVERY_UNAVAILABLE`. The trigger itself stays live, deliberately:
            `overlay-trigger.tsx` records why a decision surface that opens and then states plainly
            what cannot be recorded tells a clinician more than a dead control on the screen behind it.
          */}
          <div className="mt-2 min-w-0">
            <WorkspaceOverlayTrigger
              overlayId="resolve-failed-delivery"
              commit={{ kind: "unavailable", reason: RESOLVE_FAILED_DELIVERY_UNAVAILABLE }}
            >
              <span className="truncate">Close off this delivery &mdash; {entry.patientId}</span>
            </WorkspaceOverlayTrigger>
          </div>
        </div>
      )}
      {!mayMove ? null : (
        <ContactTimeAdjustment
          planId={entry.planId}
          contactId={entry.contactId}
          patientId={entry.patientId}
          calendarDay={entry.calendarDay}
          sendsAt={entry.sendAt}
          contactVersion={entry.contactVersion}
          actorId={acting.actorId}
          teamId={acting.teamId}
        />
      )}
    </li>
  );
}
