// src/components/caring-contacts/workspace/patient-overview-parts/first-contact.tsx
//
// The first contact date on the patient page, and why it moved when it is not the usual day.
// Split out of `patient-overview.tsx` unchanged; see that module's note for the rulings behind it.
import { CalendarClock } from "lucide-react";

import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import type { Episode } from "@/lib/caring-contacts/episode";
import type { PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";

import { plural } from "../count-wording";

/** The programme's usual first contact: the day after discharge. */
export const DEFAULT_FIRST_CONTACT_OFFSET_DAYS = 1;

export const MILLISECONDS_PER_DAY = 86_400_000;

/**
 * The first contact date, and — when it is not the programme's usual day — why it moved.
 *
 * Ruling 96 puts the CONTROL on the review-and-activation screen (Tasks 7-9) and the DISPLAY here.
 * Spec 4.4 makes the display a contract: wherever an earlier decision has moved something, the
 * surface stating it must also state why, in plain words, where the reader is looking. So the
 * reason is rendered IN PLACE beside the date — a reason reachable only by hovering has not been
 * stated.
 *
 * THE REASON COMES FROM THE EPISODE, WHICH IS WHY THIS TAKES ONE (Ruling 105)
 * ---------------------------------------------------------------------------
 * It is free text a clinician wrote about this patient, so it is held with the name, the mobile
 * number and the identifiers, and released by the one read that releases those. It is deliberately
 * NOT on `PlanRecord`: that is what the caseload renders for every patient in the team, and a
 * clinical note has no business being fetched for a list screen. `record` therefore cannot answer
 * this question and `episode` can, which is exactly the shape the placement was chosen for.
 *
 * FOUR CASES, AND THEY ARE DIFFERENT FACTS (Ruling 108)
 * ----------------------------------------------------
 * A moved date with nothing beside it has more than one cause, and this screen states which one it
 * is holding rather than picking the tidiest:
 *
 *   * the date is the usual day — no reason was ever required, so none is missing;
 *   * a reason is held — show it, verbatim, beside the date;
 *   * the episode was not released to this role — the plan is visible and the person is not, so the
 *     reason is not this screen's to show and its absence says nothing about whether one exists;
 *   * the episode was released and holds no reason — either a retention clearance removed it with
 *     the rest of the patient detail, which this screen can tell from the blank name exactly as
 *     `NoNameHeldNotice` does, or the plan predates the reason being kept at all.
 *
 * That last case is real and will persist: plans created before this field existed hold null
 * forever, and no placeholder was migrated into them. It is stated as the record's own history, not
 * as a coordinator having failed to give a reason — one WAS required and given, because
 * `buildApprovedSchedule` refuses any offset other than discharge + 1 without a non-blank one.
 * There was simply nowhere to keep it.
 */
export function FirstContact({
  record,
  episode,
  firstContact,
}: {
  record: PlanRecord;
  episode: Episode | null;
  firstContact: StoredContact;
}) {
  const day = firstContact.planned.calendarDay;
  const offset = calendarDaysBetween(awstCalendarDay(record.dischargeAt), day);

  if (offset === DEFAULT_FIRST_CONTACT_OFFSET_DAYS) {
    return (
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">First contact: </span>
        {day} (AWST) — the day after discharge, which is this programme&rsquo;s usual first contact.
      </p>
    );
  }

  const heading = "First contact moved from the usual day";
  const moved = `This plan's first contact is ${day}, ${plural(offset, "day", "days")} after discharge rather than the usual one.`;

  return (
    <>
      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">First contact: </span>
        {day} (AWST)
      </p>
      <div
        role="note"
        aria-label={heading}
        className="mt-2 flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
      >
        <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
          <CalendarClock aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="min-w-0">{heading}</span>
        </p>
        <FirstContactReason moved={moved} episode={episode} />
      </div>
    </>
  );
}

/**
 * The "Why" and "What changes it" pair inside the moved-first-contact note.
 *
 * Split out so each of the four cases is one branch returning one pair, rather than a nest of
 * conditionals inside the markup. The wording of each is the point of this component: they are four
 * different statements about what the record holds, and collapsing any two of them would make the
 * screen say something it does not know.
 */
export function FirstContactReason({ moved, episode }: { moved: string; episode: Episode | null }) {
  const reason = episode === null ? null : episode.firstContactReason;

  // A reason is held. It is a clinician's own words, so it is rendered verbatim and attributed,
  // never paraphrased or summarised into the sentence around it.
  if (reason !== null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} The coordinator who created it gave this reason: &ldquo;{reason}&rdquo;
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing on this screen. The date and its reason are set when the plan is created, and the rest of the
          twelve-month schedule hangs off the discharge day rather than off this date, so moving it moves this message
          alone.
        </p>
      </>
    );
  }

  // The role may list plans but may not read an episode, so the reason was never released to this
  // screen. Its absence is a fact about the ACTOR and says nothing about what the plan holds --
  // decided by the page from the actor, exactly as `EpisodeNotPermittedNotice` above is.
  if (episode === null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} A coordinator has to give a reason before a plan can be created with a moved first contact. That
          reason is part of this patient&rsquo;s record, which is not visible in the role you are acting in, so this
          screen is not showing it — that says nothing about whether one is held.
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing on this screen, and there is no control for it anywhere in this workspace yet. The role this
          demonstration acts in is set outside the interface.
        </p>
      </>
    );
  }

  // The episode WAS released, holds no reason, and CARRIES A RECORDED CLEARANCE (#J7PZQP).
  //
  // This used to read `episode.patientName === ""` and conclude the clearance from it. The comment
  // here said "a blank name here can only be the clearance", which was not true of the domain: the
  // column is `not null` with no CHECK, neither store's `createPlan` validates a non-blank name,
  // and the whole guarantee was `z.string().min(1)` in the plans API route. A plan that reached the
  // store with a blank name any other way made this screen tell a clinician that a reason was
  // given, that a clearance removed it, and that the removal is irreversible -- three definite
  // statements about a live record, from a sentinel that meant two things at once.
  //
  // The instant is now carried on the episode, so this is a read rather than a deduction.
  if (episode.patientDetailClearedAt !== null) {
    return (
      <>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">Why: </span>
          {moved} A coordinator has to give a reason before a plan can be created with a moved first contact, and one
          was given for this plan. A retention clearance has since removed it, along with the name, the mobile number,
          the identifiers and the cultural identity — the reason is a clinician&rsquo;s free text about this patient, so
          it is removed with the rest of them.
        </p>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          <span className="font-medium text-[color:var(--text)]">What changes it: </span>
          Nothing, here or anywhere. A clearance is not reversible, and the date above is what the record still holds.
        </p>
      </>
    );
  }

  return (
    <>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {moved} A coordinator has to give a reason before a plan can be created with a moved first contact, and one was
        given for this plan. It is not held: this plan was created before reasons were kept with the plan, so there was
        nowhere to put it. Nobody failed to give one.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Nothing, for this plan. Reasons given from now on are kept with the plan and shown here; an older plan cannot
        gain one after the fact, and inventing a sentence to fill the gap would be worse than the gap.
      </p>
    </>
  );
}

/**
 * Whole calendar days from `from` to `to`, both AWST `YYYY-MM-DD`.
 *
 * UTC midnight is used purely as a cursor and never leaves this function, which is the same
 * technique `schedule.ts` uses for the arithmetic that produced these strings in the first place.
 * This does not re-derive the schedule: the days themselves come from the module that owns them,
 * and this only measures the distance between two of them so the screen can say "seven days after
 * discharge" instead of making a clinician subtract.
 */
export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MILLISECONDS_PER_DAY);
}
