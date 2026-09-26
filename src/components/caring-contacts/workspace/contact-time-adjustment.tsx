"use client";

import { useRouter } from "next/navigation";
import { useCallback, useId, useState } from "react";

import type { ContactMoveRequestBody } from "@/lib/caring-contacts-contact-move-request";

import { awstWallTimeToInstant, toAwstParts } from "@/lib/caring-contacts/clock";
import type { ActorId, TeamId } from "@/lib/caring-contacts/ids";
import {
  canPerformCaringContactAction,
  CARING_CONTACT_ROLE_WORDING,
  type CaringContactRole,
} from "@/lib/caring-contacts/permissions";
import { APPROVED_SEND_WINDOW, isWithinApprovedSendWindow } from "@/lib/caring-contacts/schedule";

import type { MutatingOverlayId } from "./overlays/definitions";
import { WorkspaceOverlayTrigger } from "./overlays/overlay-trigger";

/**
 * Moving ONE caring contact to a different time on the day it is already scheduled for, and the
 * warning that stands in the way when the time asked for is not one this service may send at.
 *
 * Phase 2B Task 14. Two of the twenty-four overlays are raised from here -- `adjust-date-time` and
 * `outside-window-warning` -- and which one a control raises is decided by the DOMAIN's own window
 * rule, never by a copy of it written here.
 *
 * ## Why this is a Client Component, and why it is the smallest one that can be
 *
 * Ruling 13 holds this workspace's client payload to a rounding error, and the Schedule screen is a
 * Server Component with no client boundary at all. This one exists because three things it does are
 * browser facts and cannot be answered anywhere else: the coordinator TYPES a time, the connection
 * is a property of the device at the instant of the commit, and the commit itself is a click.
 *
 * It therefore takes plain values and nothing derived from a record. In particular it never names
 * `schedule-view.ts`: that module imports the repository, which names the service-state record whose
 * incident note is free text a responder typed mid-incident, and
 * `tests/caring-contacts-explained-automation.dom.test.tsx` walks this file's whole module graph for
 * exactly that name.
 *
 * ## The four rechecks happen at COMMIT time, and that is the whole point
 *
 * The frozen interaction matrix requires a mutation-bearing action to recheck connectivity,
 * permission, authentication and version state WHEN IT IS CONFIRMED, not when it is opened. A
 * coordinator can raise a confirmation and sit on it: a role switched in another tab, a connection
 * dropped, or somebody else's move landing on the same contact all happen while the overlay is open,
 * and an interface that checked at open time would record a write against a state that no longer
 * holds. So the checks run after the confirm, immediately before the request.
 *
 * Three of the four are real here and the fourth is not, which is stated rather than performed:
 *
 *   * CONNECTIVITY -- `navigator.onLine`, read at the commit.
 *   * PERMISSION -- the acting role is READ AGAIN from the service and the capability rechecked
 *     against the sealed domain's own grant table.
 *   * VERSION -- the version this screen was rendered from travels as `expectedContactVersion`, and
 *     the store refuses `stale-version` if the contact has moved since. That check is the store's,
 *     which is the only place it can be made truthfully.
 * ## What a confirmed move does to the screen it sits on
 *
 * A SUCCESS HAS TO CHANGE WHAT THE SCREEN SHOWS, not only what it says. `ContactRow` renders
 * `Sends at:` from the SERVER render, so a move that only announced itself left the row showing one
 * time and the sentence beneath it showing another. `router.refresh()` re-runs the Server Component
 * and the row catches up.
 *
 * A REFRESH IS NOT ENOUGH ON ITS OWN, AND THAT IS THE part worth reading. `contactVersion` arrives
 * as a prop, so it cannot change until that refresh completes -- and a coordinator who moves the
 * same contact twice in a row does not wait. The second write went out carrying the version the
 * FIRST one had already consumed, the store refused it as `stale-version`, and the screen said
 * somebody else had changed the contact. Nobody had. That is a false statement to a clinician on a
 * suicide-prevention schedule, produced by the screen's own previous write.
 *
 * So the version this control sends is held in state: seeded from the prop, advanced from the
 * store's OWN answer to each write, and reset whenever the server hands down a different prop than
 * it did last render (React's documented way of adjusting state when a prop changes). If a write
 * succeeds and its answer does not carry a version, the state becomes `null` and the next commit is
 * refused rather than guessed at -- a version inferred by adding one is exactly the kind of quiet
 * assumption that produced the false sentence in the first place.
 *
 *   * AUTHENTICATION -- THERE IS NONE TO RECHECK. This prototype has no credential and no session
 *     that can expire; the role switcher says of itself that it is deliberately not a login. The
 *     nearest true fact is the acting role, which the permission recheck already re-reads. Claiming
 *     an authentication check here would be theatre, so there is none.
 */

/**
 * The two rows this control raises, pinned to ids the frozen table actually carries.
 *
 * `satisfies readonly MutatingOverlayId[]` is Ruling [130] doing work rather than decorating. Both
 * rows are `mutatesState: true` in the frozen matrix, and this file's whole shape -- a commit-time
 * recheck, a guard that must not write, a refusal that survives into the next opening -- is the
 * shape a MUTATING row needs. If either row were re-frozen as non-mutating its controls would become
 * exits, and this would be the wrong wiring for them; the annotation makes that a compile error here
 * rather than a reading somebody has to make.
 */
const ADJUST_DATE_TIME = "adjust-date-time";
const OUTSIDE_WINDOW_WARNING = "outside-window-warning";
const SCHEDULE_MOVE_OVERLAY_IDS = [
  ADJUST_DATE_TIME,
  OUTSIDE_WINDOW_WARNING,
] as const satisfies readonly MutatingOverlayId[];

/** Exported so a test can walk every overlay this control is allowed to raise. */
export const SCHEDULE_MOVE_OVERLAYS: readonly MutatingOverlayId[] = SCHEDULE_MOVE_OVERLAY_IDS;

/** The capability the store checks for a within-day move, named once. */
const MOVE_ACTION = "moveContactWithinDay";

/** Where the acting role is read from, and where a move is written. Module-local, never inline. */
const SESSION_ENDPOINT = "/api/caring-contacts/session";
const CONTACT_ENDPOINT_BASE = "/api/caring-contacts/plans";

function contactEndpoint(planId: string, contactId: string): string {
  return `${CONTACT_ENDPOINT_BASE}/${encodeURIComponent(planId)}/contacts/${encodeURIComponent(contactId)}`;
}

/**
 * Sixteen hexadecimal characters mapped to sixteen letters, so the identifier holds no digit.
 *
 * A SECOND COPY of `plan-activation.ts`'s `lettersFromRandomIdentifier`, stated rather than pretended
 * away: that module belongs to the activation wizard and reaches the hospital-events and schedule
 * modules for reasons that have nothing to do with a contact move, so importing it here to borrow
 * eight lines would widen this boundary's module graph for no benefit. The right home is a module
 * both can import; it is named as a seam in the Task 14 report rather than left to be rediscovered.
 *
 * The mapping is not cosmetic. `audit.ts` scans every field of an assembled audit event against an
 * Australian mobile-number pattern and THROWS when one matches, and a random hexadecimal string can
 * produce a run of eleven digits. The write would then land with no audit record -- rare rather than
 * impossible, which is the worst kind of defect to leave in. An identifier with no digit in it
 * cannot match a number pattern, ever.
 */
const HEX_TO_LETTER = "abcdefghijklmnop";

function mintMoveIdempotencyKey(): string {
  const letters = globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .replace(/[0-9a-f]/g, (character) => HEX_TO_LETTER[Number.parseInt(character, 16)]);
  return `CONTACT-MOVE-${letters}`;
}

/** `HH:MM`, the value an `input type="time"` holds, from an instant this domain owns. */
function awstInputTime(instant: Date): string {
  const { hour, minute } = toAwstParts(instant);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** The hour and minute the field is holding, or null while it holds nothing usable. */
export function parseInputTime(value: string): { hour: number; minute: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

function twelveHourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:00 ${suffix}`;
}

/**
 * The approved sending window in the words a clinician reads, DERIVED from the two constants the
 * domain refuses against.
 *
 * Never written out. `moveContactWithinDay` refuses anything outside `APPROVED_SEND_WINDOW`, and a
 * sentence here that spelled the hours would be a second copy of them -- free to go on naming the
 * old bound after it moved, on the screen where a coordinator decides when a discharged patient
 * hears from the service.
 *
 * IT SAYS ONLY WHAT THE RULE CHECKS. `isWithinApprovedSendWindow` tests the HOUR, and the latest
 * hour is exclusive: 5:59 pm is inside the window and 6:00 pm is not. "Up to but not including" is
 * therefore exact where "between 9 and 6" would not be. This is the third place in this programme
 * where a sentence about this window claimed more than the code checks; it is written from the
 * constants so that it cannot become the fourth.
 */
function approvedWindowWording(): string {
  const from = twelveHourLabel(APPROVED_SEND_WINDOW.earliestHour);
  const to = twelveHourLabel(APPROVED_SEND_WINDOW.latestHourExclusive);
  return `from ${from} up to but not including ${to} AWST`;
}

/**
 * A refusal that stands until its recovery action succeeds.
 *
 * `reason` is the sentence a clinician reads. It is handed to the overlay as an `unavailable`
 * commit, so the next opening states it on the decision control itself with `aria-disabled` and an
 * inert handler -- the shape Ruling 87 asks for -- rather than offering a confirm that would refuse
 * all over again.
 */
type MoveGuard = { reason: string };

type MoveOutcome =
  | { kind: "none" }
  /** The synthetic in-memory write landed. `at` is the time this contact now sends at. */
  | { kind: "recorded"; at: string }
  /** Confirmed, and deliberately wrote nothing. */
  | { kind: "noChange"; reason: string }
  /** A guard refused at commit time. Nothing was written. */
  | { kind: "refused"; reason: string };

export type ContactTimeAdjustmentProps = {
  planId: string;
  contactId: string;
  /** The synthetic patient identifier, so each control on a day of rows carries its own name. */
  patientId: string;
  /** The AWST calendar day this contact is on. A move may not leave it. */
  calendarDay: string;
  /** The instant it currently sends at. */
  sendsAt: Date;
  /** The contact version this screen was rendered from -- the concurrency token for the write. */
  contactVersion: number;
  /**
   * The acting actor, for the capability recheck. Never a name and never patient data.
   *
   * The BRANDED ids rather than bare strings: the page already holds `actor.id` and `actor.teamId`
   * in that shape, and re-minting them here would let any string reach a capability check.
   */
  actorId: ActorId;
  teamId: TeamId;
};

export function ContactTimeAdjustment({
  planId,
  contactId,
  patientId,
  calendarDay,
  sendsAt,
  contactVersion,
  actorId,
  teamId,
}: ContactTimeAdjustmentProps) {
  const router = useRouter();
  const scheduledTime = awstInputTime(sendsAt);
  const fieldId = useId();
  const [chosenTime, setChosenTime] = useState(scheduledTime);
  const [guard, setGuard] = useState<MoveGuard | null>(null);
  const [outcome, setOutcome] = useState<MoveOutcome>({ kind: "none" });
  /**
   * The version this control will send, and the render it was last seeded from.
   *
   * `null` means the version is no longer known -- see the header. The paired `seededFrom` is what
   * makes the reset happen exactly once per server render rather than on every render: adjusting
   * state while a prop changes is the documented React pattern, and it needs a record of which prop
   * value the state was derived from.
   */
  const [committedVersion, setCommittedVersion] = useState<number | null>(contactVersion);
  const [seededFrom, setSeededFrom] = useState<{ version: number; scheduledTime: string }>({
    version: contactVersion,
    scheduledTime,
  });
  if (seededFrom.version !== contactVersion || seededFrom.scheduledTime !== scheduledTime) {
    // A fresh server render. Whatever this control was holding is now behind the record, including
    // a time the coordinator had typed and not confirmed: the row beneath now says something else,
    // and a field disagreeing with the row it belongs to is the divergence this whole file exists
    // to remove.
    //
    // `outcome` IS DELIBERATELY NOT CLEARED, and the reason is that the commonest render to arrive
    // here is the one THIS control asked for: `router.refresh()` after its own successful move.
    // Clearing the statement then would wipe the confirmation a coordinator had just been given, at
    // the exact moment the row caught up with it.
    //
    // The residual is stated rather than hidden: after a successful move, an EXTERNAL move plus a
    // refresh leaves "Recorded on the plan: this contact now sends at 11:30 AWST" standing beside a
    // field and a row both reading the newer time. It is the same family as the defect this
    // reseeding closed, with a narrower trigger, and it is at least in the past tense -- it says
    // what this screen recorded, which remains true. Recorded in the Task 14 report.
    setSeededFrom({ version: contactVersion, scheduledTime });
    setCommittedVersion(contactVersion);
    setChosenTime(scheduledTime);
    setGuard(null);
  }
  /**
   * The key that makes retrying THIS move a replay rather than a second write: reused while the
   * chosen time is unchanged, re-minted the moment it changes.
   *
   * Both halves matter. `runWrite` fingerprints the method and input under `(team, key)`, so a key
   * that answered one move and is then sent with a different one is refused outright as
   * `idempotency-key-reused-for-a-different-write` -- and a key minted afresh on every attempt would
   * let a retry after a timeout record the same move twice.
   */
  const [moveKey, setMoveKey] = useState(mintMoveIdempotencyKey);

  const parsed = parseInputTime(chosenTime);
  /*
    THE DOMAIN DECIDES WHICH OVERLAY THIS CONTROL RAISES.

    `isWithinApprovedSendWindow` is the same function `moveContactWithinDay` refuses against, called
    on the instant the chosen time would actually become on this contact's own day. A comparison
    written here against two numbers would be a second copy of the rule, and the two would be free to
    disagree -- so a control could offer to save a time the store then refused, or raise a warning
    about a time that was perfectly acceptable.
  */
  const chosenInstant = parsed === null ? null : awstWallTimeToInstant(calendarDay, parsed.hour, parsed.minute);
  const outsideWindow = chosenInstant !== null && !isWithinApprovedSendWindow(chosenInstant);
  const unchanged = chosenTime === scheduledTime;

  /**
   * The rechecks, run at the commit and in the order a clinician would want them answered.
   *
   * Returns the refusal, or null. Nothing here writes: a guard that refused must leave the record
   * exactly as it found it, which is why every check completes before the request is made.
   */
  const recheckAtCommit = useCallback(async (): Promise<string | null> => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      return "There is no connection, so nothing was changed. This contact still sends at the time it was already scheduled for.";
    }

    let actingRole: string | null = null;
    try {
      const answer = await fetch(SESSION_ENDPOINT, { headers: { Accept: "application/json" } });
      if (answer.ok) {
        const payload: unknown = await answer.json();
        const role = (payload as { role?: unknown } | null)?.role;
        if (typeof role === "string") actingRole = role;
      }
    } catch {
      actingRole = null;
    }

    if (actingRole === null) {
      return "The role you are acting in could not be read again, so nothing was changed. A move is recorded only against a role that has just been checked.";
    }
    // `Object.hasOwn` against the sealed domain's own role table, not a list written here: an
    // inherited key such as `constructor` resolves to a function on an ordinary object literal, and
    // a `!== undefined` guard would wave it through as a role.
    if (!Object.hasOwn(CARING_CONTACT_ROLE_WORDING, actingRole)) {
      return "The role you are acting in came back as something this workspace does not recognise, so nothing was changed.";
    }
    const role = actingRole as CaringContactRole;
    const decision = canPerformCaringContactAction({ id: actorId, teamId, roles: [role] }, MOVE_ACTION, { teamId });
    if (!decision.allowed) {
      return `The role you are acting in now is ${CARING_CONTACT_ROLE_WORDING[role]}, which is not granted the action that moves a contact, so nothing was changed.`;
    }
    return null;
  }, [actorId, teamId]);

  /** `adjust-date-time`. Rechecks, then writes -- or refuses, and writes nothing. */
  const commitMove = useCallback(async () => {
    const refusal = await recheckAtCommit();
    if (refusal !== null) {
      setGuard({ reason: refusal });
      setOutcome({ kind: "refused", reason: refusal });
      return;
    }
    if (parsed === null) {
      const reason = "No time was chosen, so nothing was changed.";
      setGuard({ reason });
      setOutcome({ kind: "refused", reason });
      return;
    }
    if (committedVersion === null) {
      // Conservative rather than clever: a version this control cannot name is one it must not
      // invent. Reloading the day reads the contact again and seeds it.
      const reason =
        "This screen no longer knows which version of this contact it is looking at, so nothing was changed. Reloading this day reads it again.";
      setGuard({ reason });
      setOutcome({ kind: "refused", reason });
      return;
    }

    /*
      THE BODY IS TYPED BY THE SCHEMA THE ROUTE REFUSES AGAINST, and the annotation is the guard.

      `contactMoveRequestSchema` is `.strict()`, so a renamed field, a missing one, or an extra one is
      a 400 at the boundary. Until this annotation existed that was caught by a TEST -- the DOM
      suite's mirror validates with the same schema -- and the schema module's own comment claimed
      more than the code delivered: it said the client that BUILDS a body and the boundary that
      REFUSES one share a definition, while the client hand-built an object literal and imported
      nothing.

      Ruling [130]'s standard, applied one layer out: wrong wiring should fail where it can be made
      to fail, which is the compiler. `ContactMoveRequestBody` is `z.infer` of that schema, so a
      rename in the schema is a compile error HERE, an omitted `action` is a missing-property error,
      and an extra field is refused by excess-property checking rather than by a round trip. The
      import is type-only and erases at build time, so nothing about the client bundle changes.
    */
    const requestBody: ContactMoveRequestBody = {
      action: "moveWithinDay",
      toHour: parsed.hour,
      toMinute: parsed.minute,
      expectedContactVersion: committedVersion,
      idempotencyKey: moveKey,
    };

    let answer: Response;
    try {
      answer = await fetch(contactEndpoint(planId, contactId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch {
      const reason =
        "The request did not reach the service, so nothing was changed here. Nothing was sent to any number either.";
      setGuard({ reason });
      setOutcome({ kind: "refused", reason });
      return;
    }

    if (!answer.ok) {
      let refusalName = "unknown";
      try {
        const payload: unknown = await answer.json();
        const named = (payload as { refusal?: unknown } | null)?.refusal;
        if (typeof named === "string") refusalName = named;
      } catch {
        refusalName = "unknown";
      }
      const reason = moveRefusalWording(refusalName);
      setGuard({ reason });
      setOutcome({ kind: "refused", reason });
      return;
    }

    // The store's OWN answer to this write, never `previous + 1`. `rescheduleContact` returns the
    // updated `StoredContact`, and reading the version off it is what lets a second move from this
    // same screen go out correctly before any refresh has landed.
    setCommittedVersion(versionFrom(await readJson(answer)));
    setGuard(null);
    setOutcome({ kind: "recorded", at: chosenTime });
    // The row above this control renders its send time from the server. Without this it would go on
    // showing the old one while the sentence below announced the new one.
    router.refresh();
  }, [chosenTime, committedVersion, contactId, moveKey, parsed, planId, recheckAtCommit, router]);

  /**
   * `outside-window-warning`. Its decision is "Keep the approved time", and keeping a time is not a
   * write.
   *
   * THE MATRIX MARKS THIS ROW `mutatesState: true` AND ITS DECISION RECORDS NOTHING. The
   * disagreement is stated rather than resolved quietly: the row's own decision text is to keep the
   * time this contact already sends at, so the honest outcome is the contract's NO CHANGE one -- the
   * field returns to the scheduled time and the statement says, in as many words, that nothing
   * outside this browser happened.
   *
   * Returning the field to the scheduled time is also the recovery. The scenario this overlay exists
   * for is a chosen time the service may not send at, and it clears here because the recovery action
   * succeeded, not because the overlay was dismissed.
   */
  const keepApprovedTime = useCallback(() => {
    setChosenTime(scheduledTime);
    setMoveKey(mintMoveIdempotencyKey());
    setOutcome({
      kind: "noChange",
      reason:
        "Nothing was changed. No message was sent, no number was contacted, and nothing outside this browser happened. This contact still sends at the time it was already scheduled for.",
    });
  }, [scheduledTime]);

  function chooseTime(value: string) {
    setChosenTime(value);
    // A different move is a different write, so it cannot reuse the key that answered the last one.
    setMoveKey(mintMoveIdempotencyKey());
    setOutcome({ kind: "none" });
  }

  /**
   * The recovery control for a standing guard, and it clears the guard ONLY if the recheck passes.
   *
   * A refusal that cleared itself the moment somebody pressed a button would be saying the condition
   * had lifted without anybody having looked.
   */
  const checkAgain = useCallback(async () => {
    /*
      A VERSION GUARD IS NOT SOMETHING THIS CONTROL CAN RECHECK.

      `recheckAtCommit` covers the connection and the acting role. It cannot read the contact's
      version -- only a server render carries that -- so clearing a version guard here would remove
      the refusal while the condition still stood, and the next confirm would refuse identically.
      Nothing would be written either way, so it is an affordance rather than a safety defect; but
      the sentence above this function says a guard clears ONLY if the recheck passes, and leaving
      that false is how a comment stops being read. The guard is kept, and the statement names the
      thing that does clear it.
    */
    if (committedVersion === null) {
      setOutcome({
        kind: "refused",
        reason:
          "This screen still does not know which version of this contact it is looking at, and checking again cannot tell it. Reloading this day reads the contact again.",
      });
      return;
    }
    const refusal = await recheckAtCommit();
    if (refusal !== null) {
      setGuard({ reason: refusal });
      setOutcome({ kind: "refused", reason: refusal });
      return;
    }
    setGuard(null);
    setOutcome({ kind: "none" });
  }, [committedVersion, recheckAtCommit]);

  const overlayId = outsideWindow ? OUTSIDE_WINDOW_WARNING : ADJUST_DATE_TIME;

  return (
    <div data-testid="caring-contacts-contact-time-adjustment" data-contact-id={contactId} className="mt-3 min-w-0">
      <label htmlFor={fieldId} className="block text-xs font-medium text-[color:var(--text-muted)]">
        Send this contact at (AWST) &mdash; {patientId}
      </label>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
        <input
          id={fieldId}
          type="time"
          value={chosenTime}
          onChange={(event) => chooseTime(event.target.value)}
          className="inline-flex min-h-tap min-w-0 items-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface)] px-3 text-sm text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]"
        />
        <WorkspaceOverlayTrigger
          overlayId={overlayId}
          commit={
            guard !== null
              ? { kind: "unavailable", reason: guard.reason }
              : outsideWindow
                ? { kind: "record", record: keepApprovedTime }
                : { kind: "record", record: commitMove }
          }
        >
          {outsideWindow ? `Check this time — ${patientId}` : `Move this contact — ${patientId}`}
        </WorkspaceOverlayTrigger>
        {guard === null ? null : (
          <button
            type="button"
            onClick={() => void checkAgain()}
            className="inline-flex min-h-tap min-w-0 items-center justify-center rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-4 text-sm font-semibold text-[color:var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] forced-colors:border-[CanvasText]"
          >
            <span className="truncate">Check again &mdash; {patientId}</span>
          </button>
        )}
      </div>

      <p className="mt-1 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
        A contact&rsquo;s send time may be changed only within the day it is already scheduled for, to a send hour{" "}
        {approvedWindowWording()}.{unchanged ? " This is the time it is already scheduled for." : ""}
      </p>

      <p
        role="status"
        data-testid="caring-contacts-contact-move-outcome"
        className="mt-1 max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]"
      >
        {outcomeWording(outcome)}
      </p>
    </div>
  );
}

/** The parsed body of a response, or null when there is nothing readable in it. */
async function readJson(answer: Response): Promise<unknown> {
  try {
    return await answer.json();
  } catch {
    return null;
  }
}

/**
 * The contact version a successful write answered with, or null.
 *
 * Null rather than a fallback, deliberately: the caller refuses the next commit rather than sending
 * a version nobody confirmed. The shape is the write handler's `{ value: StoredContact }`.
 */
function versionFrom(payload: unknown): number | null {
  const value = (payload as { value?: { contact?: { version?: unknown } } } | null)?.value;
  const version = value?.contact?.version;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : null;
}

function outcomeWording(outcome: MoveOutcome): string {
  switch (outcome.kind) {
    case "none":
      return "";
    case "recorded":
      // The synthetic in-memory outcome, said as what it is. Nothing left this demonstration.
      return `Recorded on the plan: this contact now sends at ${outcome.at} AWST. The change is held in this demonstration's own records -- no message was sent and no number was contacted.`;
    case "noChange":
      return outcome.reason;
    case "refused":
      return outcome.reason;
    default: {
      const unclassified: never = outcome;
      return unclassified;
    }
  }
}

/**
 * Plain words for each refusal the service can name, written by hand.
 *
 * A null-prototype record for the reason `handler.ts`'s own status map is one: an ordinary object
 * literal answers `["constructor"]` with an inherited function, and a `=== undefined` guard waves it
 * through. An unrecognised refusal is NAMED rather than hidden behind a general apology -- a reason
 * somebody can pass on is worth more than a reassurance nobody can act on.
 *
 * Every branch says nothing was changed, because that is the fact a coordinator most needs at the
 * moment a move fails.
 */
const MOVE_REFUSAL_WORDING: Readonly<Record<string, string>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, string>, {
    // NOT "somebody else changed this". The store answers `stale-version` for any write against a
    // version it has moved past, and it does not say what moved it -- a coordinator, a dispatcher, or
    // this very screen's own previous write. Naming a person is an inference the record cannot
    // support, and it was a FALSE one for the second move from this screen before the version was
    // tracked in state.
    "stale-version":
      "This contact changed after this screen read it, so nothing was changed here. Reloading this day shows the time it sends at now.",
    "permission-denied": "The service refused the move for the role you are acting in, so nothing was changed.",
    "action-not-granted":
      "The role you are acting in is not granted the action that moves a contact, so nothing was changed.",
    "no-roles": "The session you are acting in carries no caring-contacts role, so nothing was changed.",
    "not-found":
      "The service answered that there is nothing here to move -- the same answer it gives for a record another team holds, deliberately, so the two cannot be told apart. Nothing was changed.",
    "contact-move-outside-approved-window":
      "The service refused that time because it is not one this service may send at, so nothing was changed.",
    "contact-move-leaves-scheduled-day":
      "The service refused that time because it would fall on a different day, and a send time may be changed only within the day the contact is already scheduled for. Nothing was changed.",
    // Owner decision (2026-09-26): a contact is never moved to a time that has already passed,
    // including earlier today.
    "contact-move-time-already-passed":
      "The service refused that time because it has already passed, so nothing was changed. Choose a time that is still to come.",
    "contact-terminal": "This contact has already finished, so there is nothing left to move and nothing was changed.",
    "service-stopped":
      "Sending is stopped across the whole service, so no change may be recorded against a plan at all. Nothing was changed.",
    "idempotency-key-reused-for-a-different-write":
      "This screen sent a key that had already answered a different change, so the service refused it and nothing was changed. Choosing the time again starts a fresh attempt.",
  }),
);

export function moveRefusalWording(refusal: string): string {
  if (Object.hasOwn(MOVE_REFUSAL_WORDING, refusal)) return MOVE_REFUSAL_WORDING[refusal];
  return `The service refused the move and named the reason "${refusal}". This screen has no plain-words explanation for that one, so the reason is given as the service gave it. Nothing was changed.`;
}
