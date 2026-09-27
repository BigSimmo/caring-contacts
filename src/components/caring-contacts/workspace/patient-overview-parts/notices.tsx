// src/components/caring-contacts/workspace/patient-overview-parts/notices.tsx
//
// The patient page's notices for an episode the role may not read, and for a name that is not held.
// Split out of `patient-overview.tsx` unchanged; see that module's note for the rulings behind it.
import { EyeOff } from "lucide-react";

/**
 * The acting role may list plans but may not read an episode.
 *
 * Unreachable today and written anyway, on the same principle as `PatientsDirectory`'s names
 * notice: `permissions.ts` currently grants `generateClinicalRecordSummary` to exactly the roles
 * that hold `viewReferral`, so an actor who reached this screen with a plan in hand can always
 * read its episode. That is one grant edit away from being false, and a branch that cannot run
 * today is still read and still copied by the next screen. Nothing infers it from a missing
 * episode — the page decides it from the actor — so it cannot fire wrongly while it waits.
 */
export function EpisodeNotPermittedNotice() {
  const heading = "This patient's record is not visible in this role";
  return (
    <div
      role="note"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <EyeOff aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        Reading a patient&rsquo;s record is not part of the role you are acting in. The plan and its schedule are below;
        who the plan is for is not, and this says nothing about what is held for them.
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        Nothing on this screen, and there is no control for it anywhere in this workspace yet. The role this
        demonstration acts in is set outside the interface.
      </p>
    </div>
  );
}

/**
 * A released episode holding no name.
 *
 * `CLEARED_PATIENT_DETAIL` is what both stores write once a retention clearance is recorded, and
 * an emptied field IS the cleared value. This screen can name the cause where the directory could
 * not: an actor who may not read an episode receives no episode at all, so the role is ruled out.
 *
 * BUT THE CLEARANCE IS NOW READ, NOT DEDUCED (#J7PZQP). Ruling the role out is not the same as
 * ruling the clearance in. `patient_name` is `not null` with no CHECK and neither store's
 * `createPlan` validates it, so the only thing that made a blank name mean "cleared" was
 * `z.string().min(1)` at the plans API route -- one schema, at one edge, guarding a sentence this
 * screen states as fact on a patient record. `patientDetailClearedAt` is that fact, carried. When
 * it is null the absence is still reported, because it is real; the cause simply is not named.
 *
 * THE MOBILE NUMBER IS READ TOO, FOR THE SAME REASON (review finding). The first version of this
 * fix still said "and no mobile number is held for it either" on BOTH branches. On the cleared
 * branch that is sound -- `markRetentionCleared` empties the name, the number, the identifiers and
 * the cultural identity in one transaction. On the not-cleared branch it is another unchecked
 * claim deduced from the blank name, which is the exact defect this whole change exists to close,
 * reintroduced inside the fix. `Episode.patientMobileNumber` is right there, so it is consulted.
 */
export function NoNameHeldNotice({
  patientDetailClearedAt,
  mobileNumberHeld,
}: {
  patientDetailClearedAt: Date | null;
  mobileNumberHeld: boolean;
}) {
  const heading = "No name is held for this patient";
  return (
    <div
      role="note"
      aria-label={heading}
      className="flex min-w-0 flex-col gap-1 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
    >
      <p className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[color:var(--text-heading)]">
        <EyeOff aria-hidden="true" className="size-icon-md shrink-0" />
        <span className="min-w-0">{heading}</span>
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">Why: </span>
        {patientDetailClearedAt === null ? (
          <>
            This episode holds no patient name, so the heading above is the synthetic identifier
            {mobileNumberHeld
              ? ", though a mobile number is still held for it"
              : ", and no mobile number is held for it either"}
            . No retention clearance is recorded against this episode, so this screen cannot say why the name is absent,
            and will not guess.
          </>
        ) : (
          <>
            This episode holds no patient name, so the heading above is the synthetic identifier, and no mobile number
            is held for it either. A retention clearance removed the name, the mobile number, the identifiers and the
            cultural identity together after the episode ended.
          </>
        )}
      </p>
      <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
        <span className="font-medium text-[color:var(--text)]">What changes it: </span>
        {patientDetailClearedAt === null ? (
          <>Nothing, here or anywhere. The plan and its schedule below are what the record still holds.</>
        ) : (
          <>
            Nothing, here or anywhere. A clearance is not reversible, and the plan and its schedule below are what the
            record still holds.
          </>
        )}
      </p>
    </div>
  );
}
