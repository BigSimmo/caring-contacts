// src/components/caring-contacts/workspace/plan-wizard/plan-activation.ts
//
// What stage 4 collects, what it derives from the domain, and the body it sends.
//
// WHY THIS IS NOT INSIDE THE WIZARD'S JSX, for the same reason `patient-detail.ts` is not: every
// decision here is a decision about a VALUE, and a rule living inside a render branch is a rule
// that cannot be tested directly and that the next screen re-derives. No React, no `"use client"`,
// no storage and no `fetch`.
//
// NOTHING HERE RE-DERIVES A RULE THE DOMAIN OWNS, and stage 4 is where that temptation is
// strongest, because the schedule has four separate rules a screen would find it easy to restate:
//
//   * WHICH DAYS the first contact may fall on — `firstContactDayBounds` in `./schedule` publishes
//     them, derived from the same three constants `buildApprovedSchedule` refuses against;
//   * WHETHER A REASON IS REQUIRED — decided by comparing the chosen day against the published
//     `usual` day, which is the value `buildApprovedSchedule` itself compares against. The refusal
//     still comes from that function; this only decides whether to ASK;
//   * WHETHER A VALUE IS ACCEPTABLE — never decided here at all. `planSchedulePreview` builds the
//     real schedule and reports the domain's own named refusal;
//   * WHICH CONTACTS WILL BE SENT — `sendableContacts` in `./hospital-events` is the function the
//     store itself uses when it decides which entries to create as `scheduled` and which as
//     `suppressed`, so the preview and the plan cannot disagree about the count.
//
// The last one is proved rather than asserted: `tests/caring-contacts-plan-activation.test.ts`
// creates a plan in the in-memory store from the same input and compares this module's summary
// against `summariseStoredContacts` over the contacts that store really built.
//
// WHY `summariseStoredContacts` IS NOT CALLED HERE, though Ruling [119] names it. It takes
// `StoredContact` — a plan that already exists — and it lives in `repository.ts`, which names the
// service-state module in its own imports. `tests/caring-contacts-explained-automation.dom.test.tsx`
// scans the wizard's whole client module graph for exactly that name, because the service-state
// record carries a free-text incident note that must never cross this boundary. So the function is
// used where it can be: in the test, against the store, as the pin on what is derived here.
import { PLAN_ASSURANCES, PLAN_ASSURANCE_VALUES, type PlanAssurance } from "@/lib/caring-contacts/assurances";
import { sendableContacts } from "@/lib/caring-contacts/hospital-events";
import { awstCalendarDay, awstCalendarDayOffset, awstWallTimeToInstant } from "@/lib/caring-contacts/clock";
import type { SendingPreference } from "@/lib/caring-contacts/model";
import { buildApprovedSchedule, firstContactDayBounds, type PlannedContact } from "@/lib/caring-contacts/schedule";

// TYPE ONLY, and deliberately so. This module holds no storage and this import adds none: it erases
// at build. It is taken from `./plan-draft` rather than restated structurally so the assurance shape
// this module maps has exactly one declaration -- a third confirmation added to the draft is then a
// compile error here rather than a silently unmapped tick.
import type { PlanDraftAssurances } from "./plan-draft";

/**
 * What stage 4 collects, as the clinician has it typed so far.
 *
 * All three are held AS TYPED, for the reason `patient-detail.ts` records: the draft's job is to
 * return the screen to the state it was left in, and parsing on the way into storage would quietly
 * rewrite what was entered on every refresh.
 *
 * `dischargeDay` IS COLLECTED HERE AND NOWHERE ELSE (Ruling [121]). `createPlanSchema` requires
 * `dischargeAt` and nothing in this domain holds one before a plan exists — `Referral` is five
 * fields and carries no discharge, `hospital-events.ts` has no discharge event, and every
 * `dischargeAt` in the tree is read back out of a plan that already exists. It sits beside the
 * first-contact control because that control is defined ENTIRELY relative to it: a date control
 * anchored on a day nobody has entered means nothing.
 */
export type PlanActivationDraft = {
  /** The AWST calendar day the patient was discharged, `YYYY-MM-DD`. Empty while none is chosen. */
  dischargeDay: string;
  /** The AWST calendar day of the first contact. Empty means the programme's usual day. */
  firstContactDay: string;
  /** As typed. Required only when the first contact is not on the usual day. */
  firstContactReason: string;
};

export const EMPTY_PLAN_ACTIVATION: PlanActivationDraft = Object.freeze({
  dischargeDay: "",
  firstContactDay: "",
  firstContactReason: "",
});

/**
 * The plan's identifier and the key that makes retrying this submission safe.
 *
 * RULING [120]: minted ONCE, together, at the moment stage 4 is first reached, held in the draft,
 * and reused for every retry of that submission. `handler.ts`'s own comment is the authority —
 * "Only the caller knows whether this request is a retry of the last one."
 *
 * The failure this prevents, stated plainly because it is the worst outcome available on this
 * screen: mint a fresh `planId` per attempt and a clinician who presses Activate twice after a
 * timeout creates TWO PLANS FOR ONE PATIENT — two schedules, two sets of messages, discovered by
 * the patient rather than by the system. Minted once and reused, the second attempt is refused as
 * a replay and returns the first attempt's own answer.
 */
export type PlanSubmissionIdentity = {
  planId: string;
  /** The key that makes retrying the CREATE a replay rather than a second plan. */
  createIdempotencyKey: string;
  /**
   * The key for the second write, and it is a THIRD independent value rather than the first one
   * reused or derived.
   *
   * `runWrite` scopes a key to `(team, key)` and fingerprints the method and input under it, so a
   * key that answered the create and is then sent with the activate is refused outright as
   * `idempotency-key-reused-for-a-different-write`. The plan would exist and could never be
   * started -- the exact half-done state this second key exists to make recoverable.
   *
   * Not derived from the create key either. A derivation is a second copy of that key's
   * uniqueness, and it stops being unique the moment the derivation changes.
   */
  activateIdempotencyKey: string;
};

/**
 * Sixteen hexadecimal characters mapped to sixteen letters.
 *
 * WHY NOT THE UUID ITSELF, which `ACCESS_OBJECT_ID_PATTERN` would happily accept. `audit.ts` scans
 * every field of an assembled audit event against an Australian mobile-number pattern and THROWS
 * when one matches — and a random hexadecimal string can produce a run of eleven digits. That is
 * rare rather than impossible, which is the worst kind of defect to leave in: the plan is created,
 * the audit event cannot be built, and the write this whole workspace exists to record leaves no
 * trace. An identifier with no digits in it at all cannot match a number pattern, ever, so the
 * hazard is removed by construction rather than by a retry loop that would have to know the rule.
 */
const HEX_TO_LETTER = "abcdefghijklmnop";

function lettersFromRandomIdentifier(): string {
  return globalThis.crypto
    .randomUUID()
    .replace(/-/g, "")
    .replace(/[0-9a-f]/g, (character) => HEX_TO_LETTER[Number.parseInt(character, 16)]);
}

export function mintPlanSubmissionIdentity(): PlanSubmissionIdentity {
  // Three independent values, minted together, once. One key answers one write, so the create and
  // the activate cannot share one; and a key that WAS the plan id would collide with any later
  // write on the same plan that reused it.
  return {
    planId: `PLAN-${lettersFromRandomIdentifier()}`,
    createIdempotencyKey: `PLAN-CREATE-${lettersFromRandomIdentifier()}`,
    activateIdempotencyKey: `PLAN-START-${lettersFromRandomIdentifier()}`,
  };
}

/**
 * The instant a chosen AWST discharge day becomes, or null when it is not a real calendar day.
 *
 * MIDDAY, AND THE HOUR IS THE SCREEN'S DECISION RATHER THAN THE DOMAIN'S. `buildApprovedSchedule`
 * reads only the AWST CALENDAR DAY of `dischargeAt` — "the whole calendar hangs off the AWST
 * discharge day, not the UTC date" — so the time of day changes nothing about the schedule. What
 * it does change is what every OTHER reader of the stored instant sees, and midday is the one
 * choice that lands on the chosen day under any reasonable conversion: UTC midnight for the same
 * day is 08:00 AWST, and any wall time the clinician might have meant before that would land on
 * the day before.
 *
 * The clinician is not asked for a time because nothing in this domain uses one, and asking for a
 * value that changes nothing would invite the belief that it does.
 */
export const DISCHARGE_WALL_CLOCK_HOUR = 12;

export function dischargeInstantFor(dischargeDay: string): Date | null {
  // The domain's own parse, through the bounds it publishes: a screen that tested `YYYY-MM-DD`
  // with a regular expression would accept 2026-02-30.
  if (firstContactDayBounds(dischargeDay) === null) return null;
  const instant = awstWallTimeToInstant(dischargeDay, DISCHARGE_WALL_CLOCK_HOUR);
  return awstCalendarDay(instant) === dischargeDay ? instant : null;
}

/** How far back a discharge day may be. The plan API refuses an older one, so the screen does too. */
export const DISCHARGE_DAY_MAX_DAYS_AGO = 90;

/**
 * The earliest and latest discharge day this screen accepts, as AWST `YYYY-MM-DD` days: from
 * {@link DISCHARGE_DAY_MAX_DAYS_AGO} days before `today` up to `today` itself. A discharge in the
 * future has not happened, and one older than that is outside the aftercare window.
 */
export function dischargeDayBounds(today: string = awstCalendarDay(new Date())): { earliest: string; latest: string } {
  return { earliest: awstCalendarDayOffset(today, -DISCHARGE_DAY_MAX_DAYS_AGO), latest: today };
}

/**
 * Whether the screen must ask for a reason for the first-contact day now chosen.
 *
 * It decides WHETHER TO ASK and nothing else. `buildApprovedSchedule` decides whether the answer
 * is acceptable and names its own refusal, so this cannot make a value acceptable that the domain
 * refuses, nor refuse one the domain takes.
 *
 * The comparison is against the published `usual` day rather than against an offset written here,
 * because `usual` is the value `buildApprovedSchedule` itself compares against when it decides
 * whether a reason is required. `tests/caring-contacts-plan-activation.test.ts` walks every day in
 * the offered range and requires the two to agree.
 */
export function firstContactReasonIsRequired(input: { dischargeDay: string; firstContactDay: string }): boolean {
  if (input.firstContactDay === "") return false;
  const bounds = firstContactDayBounds(input.dischargeDay);
  if (bounds === null) return false;
  return input.firstContactDay !== bounds.usual;
}

/** How much of the schedule about to be created will be sent, and how much never will. */
export type PlannedScheduleSummary = {
  /** Every entry the schedule holds, sendable or not. */
  total: number;
  /** Entries the plan will send. */
  stillToSend: number;
  /** Entries the plan will never send, because the schedule suppressed them. */
  willNotBeSent: number;
  /** The closing message. Its own kind, and not one more caring contact. */
  closing: number;
};

export type PlanActivationIssueCode =
  "discharge-day-required" | "discharge-day-invalid" | "discharge-day-out-of-range" | "sending-preference-required";

export type PlanActivationIssue = {
  code: PlanActivationIssueCode;
  /** Plain words a clinician reads, rendered beside the control itself. Never a code. */
  message: string;
};

/**
 * The schedule this plan would run, as it stands.
 *
 * Three answers, not two, and the third is the one Ruling [117] is about: a value the DOMAIN
 * refused is a different thing from a value the clinician has not supplied yet, and a screen that
 * blended them would tell a clinician to fill in a field that is already filled in.
 */
export type PlanSchedulePreview =
  | { kind: "incomplete"; issues: readonly PlanActivationIssue[] }
  | { kind: "refused"; refusal: string }
  | {
      kind: "ready";
      contacts: readonly PlannedContact[];
      /** Entries the schedule will never send. Empty unless a chosen day collided with one. */
      absorbed: readonly PlannedContact[];
      summary: PlannedScheduleSummary;
      /** The day the first contact actually falls on, whether chosen or defaulted. */
      firstContactDay: string;
      /** Whether that day is not the programme's usual one. */
      movedFromUsualDay: boolean;
    };

export function planSchedulePreview(input: {
  activation: PlanActivationDraft;
  sendingPreference: SendingPreference | null;
  /** The AWST calendar day to treat as today. Defaults to the real one; tests pass their own. */
  today?: string;
}): PlanSchedulePreview {
  const issues: PlanActivationIssue[] = [];
  const dischargeDay = input.activation.dischargeDay.trim();

  if (dischargeDay === "") {
    issues.push({
      code: "discharge-day-required",
      message:
        "Enter the day the patient was discharged. Every date in this plan is counted from it, so nothing can be worked out until it is entered, and no record this prototype can read carries it.",
    });
  } else if (dischargeInstantFor(dischargeDay) === null) {
    issues.push({
      code: "discharge-day-invalid",
      message: "Enter the discharge day as a real date. Nothing was worked out from what is entered now.",
    });
  } else {
    const range = dischargeDayBounds(input.today);
    // `YYYY-MM-DD` strings compare correctly as text.
    if (dischargeDay < range.earliest || dischargeDay > range.latest) {
      issues.push({
        code: "discharge-day-out-of-range",
        message: `Enter a discharge day from ${range.earliest} to ${range.latest}. A discharge cannot be in the future, and one more than ${DISCHARGE_DAY_MAX_DAYS_AGO} days ago is outside the aftercare window.`,
      });
    }
  }

  if (input.sendingPreference === null) {
    issues.push({
      code: "sending-preference-required",
      message:
        "Choose when in the day messages go out, back on the personalisation stage. Every send time in this plan comes from it.",
    });
  }

  if (issues.length > 0) return { kind: "incomplete", issues };

  const dischargeAt = dischargeInstantFor(dischargeDay);
  const bounds = firstContactDayBounds(dischargeDay);
  // Both were established non-null above; the guard is here because a `!` would be an assertion
  // about a branch rather than a fact the reader can check.
  if (dischargeAt === null || bounds === null) {
    return { kind: "refused", refusal: "invalid-discharge-instant" };
  }

  const chosenDay = input.activation.firstContactDay.trim();
  const reason = input.activation.firstContactReason.trim();
  const schedule = buildApprovedSchedule({
    dischargeAt,
    sendingPreference: input.sendingPreference as SendingPreference,
    firstContactDate: chosenDay === "" ? bounds.usual : chosenDay,
    // Passed as typed rather than only when required. `buildApprovedSchedule` is what decides
    // whether a reason was needed, and a screen that withheld one it thought unnecessary would be
    // deciding that question itself.
    firstContactReason: reason === "" ? undefined : reason,
  });
  if (!schedule.ok) return { kind: "refused", refusal: schedule.reason };

  const sendable = sendableContacts(schedule.contacts);
  const sendableSequences = new Set(sendable.map((contact) => contact.sequence));
  const absorbed = schedule.contacts.filter((contact) => !sendableSequences.has(contact.sequence));
  const firstContactDay = chosenDay === "" ? bounds.usual : chosenDay;

  return {
    kind: "ready",
    contacts: schedule.contacts,
    absorbed,
    summary: {
      total: schedule.contacts.length,
      stillToSend: sendable.length,
      // The complement of what the domain answered, never a second predicate over the same
      // contacts: two predicates are two answers to "how much of this plan will be sent", and the
      // patient overview's own note records what that cost the first time.
      willNotBeSent: schedule.contacts.length - sendable.length,
      closing: schedule.contacts.filter((contact) => contact.messageType === "closing").length,
    },
    firstContactDay,
    movedFromUsualDay: firstContactDay !== bounds.usual,
  };
}

/**
 * What choosing this first-contact day COSTS, answered before the day has been justified.
 *
 * ROUND 2, I3. `planSchedulePreview` refuses `first-contact-reason-required` on any moved day, so
 * the absorbed-contact notice built from it did not appear until a reason had been typed -- the
 * clinician learned the choice removes a contact from a suicide-prevention schedule only AFTER
 * justifying it. Ruling [118] still technically held (it is before commitment) but the order is
 * backwards for an explained-automation surface: the consequence is an input to the decision, not a
 * receipt for it.
 *
 * So this asks the domain the same question with the reason requirement satisfied by a stand-in.
 * THE STAND-IN IS NEVER SENT ANYWHERE: it exists inside this call, only `absorbed` and `summary`
 * are read from the result, and the submission path still goes through `createPlanRequestBody`,
 * which uses what the clinician actually wrote and returns null while that is missing. Nothing here
 * can make a plan that carries this string.
 *
 * It answers null whenever the domain refuses for any OTHER reason -- an out-of-range day, an
 * unreadable discharge day -- because then there is no schedule to describe a consequence of, and
 * the refusal itself is what the screen should be showing.
 */
const REASON_STAND_IN = "(not yet given)";

export function firstContactConsequence(input: {
  activation: PlanActivationDraft;
  sendingPreference: SendingPreference | null;
}): { absorbed: readonly PlannedContact[]; summary: PlannedScheduleSummary } | null {
  const preview = planSchedulePreview({
    activation: {
      ...input.activation,
      firstContactReason: input.activation.firstContactReason.trim() || REASON_STAND_IN,
    },
    sendingPreference: input.sendingPreference,
  });
  if (preview.kind !== "ready") return null;
  return { absorbed: preview.absorbed, summary: preview.summary };
}

/**
 * Exactly the body `createPlanSchema` accepts, and exactly that -- the schema is `.strict()`, so a
 * key this type has and the schema does not is refused outright rather than ignored.
 */
export type CreatePlanRequestBody = {
  planId: string;
  referralId: string;
  patientId: string;
  pathwayVersionId: string;
  dischargeAt: string;
  sendingPreference: SendingPreference;
  firstContactDate: string;
  firstContactReason?: string;
  patientDetail: {
    patientName: string;
    patientMobileNumber: string;
    patientIdentifiers: string[];
    culturalIdentity: string | null;
    /**
     * What the patient asked to be called in messages. Nullable on the wire because a caller may
     * genuinely hold none; `createPlanPatientDetail` never sends null, because a name the message
     * cannot be built from stops the plan being created at all.
     */
    preferredName: string | null;
  };
  /**
   * What the coordinator attested to having confirmed at stage 1, as the domain's own closed
   * values. Never a pair of booleans on the wire: the set is not frozen, and a third confirmation
   * should be a value rather than a schema change.
   */
  assurances: PlanAssurance[];
  idempotencyKey: string;
};

/**
 * The stage-1 tick-boxes as attestations.
 *
 * WHAT AN ENTRY MEANS, and it is the distinction this whole feature turns on: a coordinator
 * confirmed a check. It is not a record of the patient's consent -- this system is not where consent
 * lives -- and nothing built on the returned list may present it as one.
 *
 * An unticked confirmation contributes NOTHING rather than an entry saying "not confirmed". A row
 * asserting a negative would be a claim nobody made; absence is what "this was not confirmed" looks
 * like, here and in the table this reaches.
 */
export function planAssurancesFrom(assurances: PlanDraftAssurances): PlanAssurance[] {
  const attested: PlanAssurance[] = [];
  if (assurances.patientAgreed) attested.push(PLAN_ASSURANCES.patientAgreementConfirmed);
  if (assurances.mobileIsPatientControlled) attested.push(PLAN_ASSURANCES.patientControlsMobileConfirmed);
  return attested;
}

/**
 * Whether every confirmation this sign-up asks for has been made.
 *
 * ONE PREDICATE, TWO CALLERS, AND THE SECOND IS WHY IT EXISTS. Stage 1 will not let a coordinator
 * choose a pathway until both are ticked, and that used to be the only place it mattered — nothing
 * was recorded either way, so a draft restored at a later stage with one tick missing changed
 * nothing about the plan. It does now: `createPlanRequestBody` builds a list of attestations, and a
 * half-ticked restored draft would otherwise create a plan attesting one confirmation that had
 * never passed the gate. Stage 4 asks the same question this function answers for stage 1.
 *
 * It is not the DOMAIN's rule and must not become one. `admitPlanAssurances` requires a plan to
 * carry at least one attestation and to name none twice; WHICH confirmations are asked for belongs
 * to the screen that asks, and the approved design's assurance set is not frozen.
 */
export function everyAssuranceConfirmed(assurances: PlanDraftAssurances): boolean {
  return assurances.patientAgreed && assurances.mobileIsPatientControlled;
}

/**
 * How each confirmation is named back to a coordinator who has not made it.
 *
 * SCREEN VOCABULARY, HELD BY THE SCREEN. The domain owns the closed values and says nothing about
 * how they read; a `Record<PlanAssurance, string>` is what makes that pairing exhaustive, so adding
 * a value to `PLAN_ASSURANCES` stops this object compiling until it is given words. That is the
 * whole reason it is a keyed record rather than a switch with a default.
 *
 * Each phrase names WHAT WAS TO BE CONFIRMED, and never asserts it. "that the patient agreed to
 * receive caring contacts" is the thing a coordinator confirms they checked; a plan that cannot say
 * anybody checked it must not word the gap as though the patient had refused.
 */
const PLAN_ASSURANCE_LABELS: Readonly<Record<PlanAssurance, string>> = Object.freeze({
  [PLAN_ASSURANCES.patientAgreementConfirmed]: "that the patient agreed to receive caring contacts",
  [PLAN_ASSURANCES.patientControlsMobileConfirmed]: "that the number this plan will use is the patient's own",
});

/**
 * The confirmations still to be made, named rather than counted.
 *
 * DERIVED BY SUBTRACTING what has been confirmed from the domain's own list, rather than by a branch
 * per checkbox. That is why this returns a LIST rather than a ready-made sentence with "one" or
 * "both" baked into it: the sentence stays correct however many confirmations there are.
 *
 * WHAT THAT DOES AND DOES NOT BUY, stated exactly, because the first version of this paragraph
 * claimed the whole wizard scaled and it does not. THIS function needs nothing when a third
 * confirmation is added: a value in `PLAN_ASSURANCES` and a label in `PLAN_ASSURANCE_LABELS`, and
 * the record type makes the label mandatory. The wizard around it does NOT scale that way —
 * `PlanDraftAssurances` gains a field, its parser gains a check, `planAssurancesFrom` gains a
 * branch, and `everyAssuranceConfirmed` gains a conjunct, because both of those are written against
 * the draft's named booleans rather than against the domain list. Widening them is a separate piece
 * of work and it is not pretended away here.
 */
export function unconfirmedAssuranceLabels(assurances: PlanDraftAssurances): string[] {
  const confirmed = new Set<PlanAssurance>(planAssurancesFrom(assurances));
  return PLAN_ASSURANCE_VALUES.filter((assurance) => !confirmed.has(assurance)).map(
    (assurance) => PLAN_ASSURANCE_LABELS[assurance],
  );
}

/**
 * What stage 4 says when it will not create the plan yet, naming WHICH confirmation is missing.
 *
 * "At least one of the confirmations is not ticked" was the first version and it is the defect this
 * function exists to remove: it tells a coordinator they are blocked without telling them by what,
 * on the screen where the only remedy is to go back a stage and find it themselves.
 *
 * No tally appears in the returned sentence (Ruling [94]). The items are listed, and a list does not
 * decay when a third confirmation is added the way "both" and "one of the two" do.
 */
export function unconfirmedAssuranceSentence(assurances: PlanDraftAssurances): string {
  const missing = unconfirmedAssuranceLabels(assurances);
  const listed =
    missing.length > 1 ? `${missing.slice(0, -1).join("; ")}; and ${missing[missing.length - 1]}` : missing[0];
  return (
    `This plan cannot be created until every confirmation at the start of this sign-up is ticked. Still to confirm: ${listed}. ` +
    "The plan records each confirmation as yours, and a confirmation nobody made is not something it can record."
  );
}

/**
 * The body this screen POSTs, or null while anything required is missing.
 *
 * `patientDetail` is TAKEN, not built: `createPlanPatientDetail` in `./patient-detail` already
 * decides what is trimmed, what is required and that cultural identity reaches a plan as `null`
 * whatever a stale draft holds. Re-deriving any of that here would be a second copy of a rule that
 * exists to have exactly one.
 *
 * `firstContactReason` is OMITTED rather than sent empty. The schema types it
 * `z.string().min(1).optional()`, so `""` is refused outright and a plan carrying one could not be
 * created at all — the same shape as `culturalIdentity`, one field over.
 *
 * `assurances` is the opposite case, and its guard is not decoration. The schema requires a
 * non-empty list and the store refuses an empty one by name, so a body attesting nothing is never
 * built. The guard is `everyAssuranceConfirmed`, not "at least one", because a draft restored from a
 * tab's storage is parsed input rather than a promise: a draft sitting at stage 4 with one tick
 * missing would otherwise create a plan attesting a confirmation that never passed stage 1's gate.
 * A body that could not honestly be created must be no body rather than a refused one.
 */
export function createPlanRequestBody(input: {
  submission: PlanSubmissionIdentity | null;
  referralId: string;
  patientId: string;
  pathwayVersionId: string | null;
  activation: PlanActivationDraft;
  sendingPreference: SendingPreference | null;
  patientDetail: CreatePlanRequestBody["patientDetail"] | null;
  assurances: PlanDraftAssurances;
  /** The AWST calendar day to treat as today. Defaults to the real one. */
  today?: string;
}): CreatePlanRequestBody | null {
  if (input.submission === null) return null;
  if (input.pathwayVersionId === null) return null;
  if (input.sendingPreference === null) return null;
  if (input.patientDetail === null) return null;

  if (!everyAssuranceConfirmed(input.assurances)) return null;
  const assurances = planAssurancesFrom(input.assurances);

  const preview = planSchedulePreview({
    activation: input.activation,
    sendingPreference: input.sendingPreference,
    today: input.today,
  });
  if (preview.kind !== "ready") return null;

  const dischargeAt = dischargeInstantFor(input.activation.dischargeDay.trim());
  if (dischargeAt === null) return null;

  const reason = input.activation.firstContactReason.trim();
  return {
    planId: input.submission.planId,
    referralId: input.referralId,
    patientId: input.patientId,
    pathwayVersionId: input.pathwayVersionId,
    dischargeAt: dischargeAt.toISOString(),
    sendingPreference: input.sendingPreference,
    // The day the screen SHOWED, not the domain's default. A clinician reads a date back and the
    // plan is created for the date that was read back, whether or not they chose it themselves.
    firstContactDate: preview.firstContactDay,
    ...(reason === "" ? {} : { firstContactReason: reason }),
    patientDetail: input.patientDetail,
    assurances,
    idempotencyKey: input.submission.createIdempotencyKey,
  };
}

/** Exactly the body the plan lifecycle route accepts for `activate`. */
export type ActivatePlanRequestBody = {
  action: "activate";
  expectedVersion: number;
  idempotencyKey: string;
};

/**
 * The second write's body.
 *
 * `expectedVersion` is an optimistic-concurrency check and it comes from the CREATE'S OWN ANSWER,
 * never from a constant. Writing `1` would be right today and wrong the moment anything touches the
 * plan between the two writes -- and the store would then refuse `stale-version` on a plan created
 * seconds earlier, which is the least explicable failure this screen could produce.
 */
export function activatePlanRequestBody(input: {
  submission: PlanSubmissionIdentity;
  expectedVersion: number;
}): ActivatePlanRequestBody {
  return {
    action: "activate",
    expectedVersion: input.expectedVersion,
    idempotencyKey: input.submission.activateIdempotencyKey,
  };
}

/**
 * The version the created plan is at, read out of what the create answered, or null.
 *
 * NULL RATHER THAN A DEFAULT, and the difference is the whole point. A default would be a guess
 * wearing a number: it would send a version nobody read, and the refusal it earned would be about
 * concurrency rather than about the answer this screen could not understand. Null means the second
 * write is not attempted at all, and the screen says the plan exists and has not started -- which
 * is true, and recoverable, and what a guess would have obscured.
 *
 * `writeHandler` answers a successful write with `{ value: <result> }`, and `createPlan`'s result is
 * a `PlanRecord`. Everything about that shape is checked here rather than assumed, because it
 * arrives over the wire.
 */
export function planVersionFromCreateAnswer(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  const value = (payload as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return null;
  const plan = (value as { plan?: unknown }).plan;
  if (typeof plan !== "object" || plan === null) return null;
  const version = (plan as { version?: unknown }).version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return null;
  return version;
}

/**
 * What the screen says when a write is refused, in the three-part shape spec §4.4 sets.
 *
 * THE SHAPE IS SHARED BY BOTH WRITES; THE WORDING IS NOT. This type is used by
 * `submissionRefusalWording` below, which covers the create, and by `activationRefusalWording`,
 * which covers the start -- and the two may never borrow each other's sentences, because "Nothing
 * was created" is true of one and false of the other. Everything below this line describes the
 * create-stage table.
 *
 * RULING [117], THIRD ORDERING. "Something went wrong" is not acceptable on the screen that creates
 * a suicide-prevention contact plan: the refusals name genuinely different situations, and a
 * clinician who is told "you may not do this" acts differently from one told "this patient already
 * has a plan" or "the schedule could not be built from these dates".
 *
 * TOTAL over every string, and the default NAMES THE REFUSAL rather than hiding it. A refusal this
 * screen has never seen is still a fact somebody can act on, and an unnamed one is a support call
 * that starts from nothing.
 *
 * EVERY BRANCH SAYS THE DRAFT SURVIVED, because that is the second ordering of the same ruling and
 * it is the thing a clinician most needs to know at the moment a write fails: nothing they typed
 * has been lost. It is written into each wording rather than appended once, so a branch added later
 * cannot omit it silently — the test walks every refusal and requires the sentence.
 */
export type SubmissionRefusalWording = { heading: string; because: string; changedBy: string };

const DRAFT_SURVIVED = "Everything you entered is still on this computer, in this tab, exactly as you left it.";

const REFUSAL_WORDING: Readonly<Record<string, SubmissionRefusalWording>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, SubmissionRefusalWording>, {
    "action-not-granted": {
      heading: "Your role cannot create a plan",
      because: `The role you are signed in as is not granted the action that creates a plan, so nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Signing in as a role that may claim a plan, or asking someone who holds that role to finish this.",
    },
    "no-roles": {
      heading: "This session carries no role, so nothing may be created",
      because: `The session you are acting in has no caring-contacts role at all, so no action can be checked against it and nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Signing in again so the session carries a role.",
    },
    "permission-denied": {
      heading: "This plan cannot be created in this role",
      because: `The store refused the write for this actor, so nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Signing in as a role that may claim a plan, or asking someone who holds that role to finish this.",
    },
    "cross-team-denied": {
      heading: "This plan cannot be created by this team",
      because: `The referral this sign-up started from belongs to another team, so nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Starting the sign-up again from a referral your own team accepted.",
    },
    "not-found": {
      heading: "Nothing here could be found to create a plan against",
      because: `The service answered that there is nothing to act on — which is the same answer it gives for a record another team holds, deliberately, so the two cannot be told apart. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Starting the sign-up again from a referral your own team accepted.",
    },
    "duplicate-active-plan": {
      heading: "This patient already has a plan that has not ended",
      because: `A patient may hold one open plan at a time, across every team, because two open plans would send two sets of messages to one person. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy:
        "Opening the plan this patient already has. If it should not be running, it has to be withdrawn before another can start.",
    },
    "plan-already-exists": {
      heading: "A plan with this identifier already exists",
      because: `The identifier this sign-up minted is already in use, so nothing new was created. ${DRAFT_SURVIVED}`,
      changedBy: "Discarding this draft and starting the sign-up again, which mints a new identifier.",
    },
    "idempotency-key-reused-for-a-different-write": {
      heading: "This submission no longer matches the one it is retrying",
      because: `The key this sign-up holds was recorded against a different set of answers, so the service refused it rather than treating it as a retry — that check is what stops one patient getting two plans. Nothing was created by this attempt. ${DRAFT_SURVIVED}`,
      changedBy:
        "Discarding this draft and starting again. If a plan was created by the earlier attempt, it is on the patient's own screen.",
    },
    "stale-version": {
      heading: "Something else changed this record first",
      because: `The record moved between this screen reading it and this write reaching it, so the write was refused rather than applied over the change. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Reloading this screen so it reads the record as it now stands, then trying again.",
    },
    "service-stopped": {
      heading: "The service is stopped, so no plan can start",
      because: `A service-wide safety stop is in place and it holds every write, including this one. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Three different roles approving the restart. Until then no plan can be started by anyone.",
    },
    "access-audit-unavailable": {
      heading: "The access trail could not record this, so nothing was released",
      because: `Every read and write here is recorded, and one that cannot be recorded does not happen — that is the bargain, not a fault in this screen. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Trying again once the trail is available. Nothing about this draft has to be entered twice.",
    },
    "invalid-request": {
      heading: "The service would not read this request",
      because: `The request did not become one the service could act on, so it refused it before anything was checked. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Checking the dates and details on this screen, then trying again.",
    },
    "request-body-too-large": {
      heading: "This submission is larger than the service accepts",
      because: `The service holds a size limit on every request, and this one is over it. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Shortening the identifiers or the reason for the first-contact day, then trying again.",
    },
    "first-contact-invalid-date": {
      heading: "The schedule could not be built from the dates given",
      because: `The first-contact day is not a real date, so no schedule could be worked out and nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Choosing a first-contact day from the range this screen offers.",
    },
    "first-contact-out-of-range": {
      heading: "The schedule could not be built from the dates given",
      because: `The first-contact day is outside the range this programme allows, so no schedule could be worked out and nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Choosing a first-contact day inside the range this screen offers.",
    },
    "first-contact-reason-required": {
      heading: "The schedule could not be built without a reason for the moved day",
      because: `The first contact is not on the usual day, and a day that has been moved is recorded with the reason it moved. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Writing why the day was moved, or putting the first contact back on the usual day.",
    },
    "first-contact-reason-too-long": {
      heading: "The schedule could not be built because the reason is too long",
      because: `The reason is longer than this programme records. It is refused whole rather than cut short, because a clinical reason cut off mid-sentence can say the opposite of what was written. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Shortening the reason to a few sentences, then trying again.",
    },
    "unknown-sending-preference": {
      heading: "The schedule could not be built from the sending preference",
      because: `The preference held for this sign-up is not one this programme sends at, so no send times could be worked out and nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Going back to the personalisation stage and choosing when in the day messages go out.",
    },
    "invalid-discharge-instant": {
      heading: "The schedule could not be built from the discharge day",
      because: `Every date in the plan is counted from the discharge day, and the day held for this sign-up is not one a calendar recognises. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Entering the discharge day again as a real date.",
    },
    "contacts-not-strictly-increasing": {
      heading: "The schedule could not be built without two messages on one day",
      because: `The dates given would have put two caring contacts on the same day, which this programme never does, so the schedule was refused whole. Nothing was created. ${DRAFT_SURVIVED}`,
      changedBy: "Choosing a different first-contact day, or checking the discharge day is the one you meant.",
    },
    "request-did-not-reach-the-service": {
      heading: "This did not reach the service",
      because: `The request did not complete, so the service was never asked and nothing was created. This is what a lost connection looks like from here. ${DRAFT_SURVIVED}`,
      changedBy:
        "Trying again. Retrying is deliberately harmless: this sign-up reuses the same identifiers, so a plan cannot be created twice.",
    },
    "service-answered-with-something-unreadable": {
      heading: "The service's answer could not be read",
      because: `Something came back that this screen could not understand, so it will not claim the plan was created and it will not claim it was not. ${DRAFT_SURVIVED}`,
      changedBy:
        "Checking the patient's own screen for a plan before trying again. Retrying is harmless either way — this sign-up reuses the same identifiers.",
    },
  }),
);

export function submissionRefusalWording(refusal: string): SubmissionRefusalWording {
  const known = REFUSAL_WORDING[refusal];
  if (known !== undefined) return known;
  return {
    heading: "The service refused this, and gave a reason this screen has not been taught",
    // The refusal is NAMED. An unrecognised reason is still a fact somebody can act on, and hiding
    // it behind a general apology is how a support call starts from nothing.
    because: `The service refused the write and named the reason "${refusal}". This screen has no plain-words explanation for that one, so the reason is given as the service gave it. Nothing was created. ${DRAFT_SURVIVED}`,
    changedBy:
      "Passing that reason on to whoever supports this service. Retrying is harmless — this sign-up reuses the same identifiers, so a plan cannot be created twice.",
  };
}

/**
 * What each kind of message in the schedule is called.
 *
 * A SECOND COPY OF `MESSAGE_TYPE_LABELS` IN `patient-overview.tsx`, AND IT IS STATED RATHER THAN
 * PRETENDED AWAY. That module cannot be imported here: it reads `repository.ts`, which names the
 * service-state module, and `tests/caring-contacts-explained-automation.dom.test.tsx` scans this
 * wizard's whole client module graph for exactly that name. So the two screens hold the same three
 * strings and nothing keeps them in step. The right home is a module both can import — see the Task
 * 9 report, which names it as a seam rather than leaving the duplication for the next reader to
 * discover.
 *
 * The closing message has its own label because it is its own kind: it ends the plan and is not one
 * more caring contact. Calling it one would overstate the plan by one message.
 */
export const PLANNED_MESSAGE_TYPE_LABELS: Readonly<Record<PlannedContact["messageType"], string>> = Object.freeze({
  first: "First message",
  standard: "Caring contact",
  closing: "Closing message",
});

/**
 * The schedule summary as a sentence, built from what was measured.
 *
 * Ruling [94]: the invariant is stated and the number is not restated in prose around it. The
 * numbers here ARE the measurement — they come from `plannedScheduleSummary` above, which comes
 * from the domain — so this is the one place a count belongs.
 */
export function plannedScheduleSentence(summary: PlannedScheduleSummary): string {
  const entries = `${summary.total} ${summary.total === 1 ? "entry" : "entries"}`;
  if (summary.willNotBeSent === 0) return `${entries}, and every one of them will be sent.`;
  return `${entries}: ${summary.stillToSend} still to send, and ${summary.willNotBeSent} that will not be sent.`;
}

/**
 * WHAT IS TRUE AFTER THE CREATE AND BEFORE THE START, checked against the store rather than assumed.
 *
 * The first version of this said "no message is scheduled to go out yet". THAT IS FALSE.
 * `createPlan` writes every planned contact in state `scheduled` (or `suppressed` for an absorbed
 * one) AT CREATION, so creating a plan schedules its contacts, full stop, and a reassurance to the
 * contrary was one the code does not support -- printed on the exact screen a coordinator acts on.
 * That is still true, and it is what this copy says.
 *
 * WHAT HAS CHANGED (#PAMATF): the open domain question this note used to defer is now answered. It
 * recorded that `listSendableContacts` filtered on `contact.state === "scheduled"` with NO
 * plan-state gate, so a draft plan's contacts presented there as sendable. Both stores now consult
 * `planSendingHold` first, so a draft plan offers nothing sendable. The copy below is UNCHANGED by
 * that, and deliberately: the contacts really are scheduled, which is what it says. What is no
 * longer true is that anything would treat them as ready to go out.
 *
 * What still stops a message regardless is that there is nothing that sends: this prototype is
 * connected to no messaging provider, and the only reader of `listSendableContacts` anywhere in the
 * tree is `simulation.ts`.
 */
const PLAN_EXISTS =
  "The plan was created and is on this patient's record, and its contacts are scheduled -- creating a plan schedules them. No second plan was created. Nothing reaches any handset either way: this prototype is connected to no messaging provider and has nothing that sends.";

/** The half of the story that is only true while the plan is still waiting to be started. */
const NOT_STARTED = " The plan has not been started.";

const PRESS_AGAIN =
  "Confirming again finishes starting the same plan: this sign-up still holds its identifier, so it cannot create a second plan for this patient.";

/**
 * What the screen says when the plan WAS created and could not be started.
 *
 * A SEPARATE MAPPING FROM `submissionRefusalWording`, AND THAT IS THE POINT RATHER THAN TIDINESS.
 * Every branch of that one says "Nothing was created", which is true of the first write and FALSE
 * here. A coordinator told nothing was created starts the sign-up again -- and this patient gets a
 * second plan, two schedules and two sets of messages, which is the worst outcome available on this
 * screen. So the two failures get two vocabularies and neither can borrow the other's.
 *
 * WHAT EVERY BRANCH SAYS, and what only some do -- because an earlier version of this comment
 * asserted a short list of things as true of all of them, and most of that list was not:
 *
 *   * ALL: the plan was created, its contacts are scheduled, and nothing reaches a handset because
 *     there is no provider and nothing that sends (see `PLAN_EXISTS`).
 *   * ALL: what to do next, and that it concerns THE SAME PLAN rather than a second one -- the
 *     payoff of Ruling [120]'s mechanism, since the draft still holds the plan id and both keys.
 *   * ONLY WHERE IT IS TRUE: that the plan has not been started (`NOT_STARTED`). It is withheld by
 *     `plan-not-draft`, `plan-terminal` and `service-answered-with-something-unreadable`, where the
 *     plan may already be running, so those say the state is unknown and send the reader to look
 *     instead.
 *   * NOT UNIFORM, AND NOT SUMMARISABLE: what to do about pressing again. Those same branches each
 *     say something different -- `plan-not-draft` tells the clinician not to, `plan-terminal` says
 *     nothing either way, and `service-answered-with-something-unreadable` invites it after a look.
 *     So "pressing again finishes it" was never true of every branch, and neither is any single
 *     sentence about what the withholding branches advise. Read them.
 *
 * No tally appears above, and that is deliberate rather than terse (Ruling [94] applies to source as
 * much as to a screen). The previous version of this bullet counted the withholding branches and
 * then counted how many of them warn against pressing again -- and that second tally was wrong, in
 * the direction that matters: it credited branches with a warning only `plan-not-draft` gives. A
 * number in a comment is a claim nobody re-derives, which is how a paragraph written to CORRECT an
 * over-claim came to make one. `tests/caring-contacts-plan-activation.test.ts` holds the lists, so a
 * branch added to the wrong one goes red there instead of quietly disagreeing with this paragraph.
 */
const ACTIVATION_REFUSAL_WORDING: Readonly<Record<string, SubmissionRefusalWording>> = Object.freeze(
  Object.assign(Object.create(null) as Record<string, SubmissionRefusalWording>, {
    "plan-not-draft": {
      heading: "The plan was created, and it may already have started",
      because: `${PLAN_EXISTS} The service answered that the plan is not waiting to be started, which usually means an earlier attempt already started it and this screen never saw the answer.`,
      changedBy:
        "Opening the plan on the patient's screen and looking at whether it is running. Do not start the sign-up again — it is the same plan, and starting over cannot create a second one but will not tell you anything either.",
    },
    "plan-terminal": {
      heading: "The plan was created, and it has already been ended",
      because: `${PLAN_EXISTS} The service answered that this plan has reached an end state, so it cannot be started.`,
      changedBy:
        "Opening the plan on the patient's screen to see what ended it. It is the same plan; nothing here will create a second one.",
    },
    "stale-version": {
      heading: "The plan was created, and something else changed it before it started",
      because: `${PLAN_EXISTS}${NOT_STARTED} The plan moved between this screen reading it and the request to start it arriving, so the service refused rather than applying over the change.`,
      changedBy: PRESS_AGAIN,
    },
    "not-found": {
      heading: "The plan was created, and the service will not confirm it is startable",
      because: `${PLAN_EXISTS}${NOT_STARTED} The service answered that there is nothing to act on — the same answer it gives for a record another team holds, deliberately, so the two cannot be told apart.`,
      changedBy: `${PRESS_AGAIN} If it keeps refusing, the plan is on the patient's screen and someone with access to it can start it.`,
    },
    "permission-denied": {
      heading: "The plan was created, and this role may not start it",
      because: `${PLAN_EXISTS}${NOT_STARTED} The store refused the request to start it for this actor.`,
      changedBy:
        "Asking someone whose role may start a plan to open it on the patient's screen. It is the same plan; starting the sign-up again cannot create a second one.",
    },
    "action-not-granted": {
      heading: "The plan was created, and your role cannot start it",
      because: `${PLAN_EXISTS}${NOT_STARTED} The role you are signed in as is granted the action that creates a plan but not the one that starts it.`,
      changedBy:
        "Asking someone whose role may start a plan to open it on the patient's screen. It is the same plan; nothing will create a second one.",
    },
    "no-roles": {
      heading: "The plan was created, and this session carries no role to start it with",
      because: `${PLAN_EXISTS}${NOT_STARTED} The session you are acting in has no caring-contacts role, so the request to start it could not be checked against one.`,
      changedBy: `Signing in again so the session carries a role, then ${PRESS_AGAIN.charAt(0).toLowerCase()}${PRESS_AGAIN.slice(1)}`,
    },
    // A test text was sent to this plan's number and nobody has said it arrived (or someone said it
    // did not). Starting would send caring contacts to a number that has not been shown to reach the
    // patient, so the service holds the start until the test text is settled on the patient's page.
    "mobile-check-unconfirmed": {
      heading: "The plan was created, and it cannot start until the test text is confirmed",
      because: `${PLAN_EXISTS}${NOT_STARTED} A test text was sent to this plan's mobile number and nobody has confirmed that it arrived, so the service will not start the plan in case the number is wrong.`,
      changedBy:
        "Opening the plan on the patient's screen and confirming there that the test text arrived — or, if it did not, checking the number with the patient and sending the test text again. Then start it from there. It is the same plan; nothing here will create a second one.",
    },
    "service-stopped": {
      heading: "The plan was created, and the service is stopped so it cannot start",
      because: `${PLAN_EXISTS}${NOT_STARTED} A service-wide safety stop is in place and it holds every write, including the one that starts a plan.`,
      changedBy: `Three different roles approving the restart. After that, ${PRESS_AGAIN.charAt(0).toLowerCase()}${PRESS_AGAIN.slice(1)}`,
    },
    "invalid-request": {
      heading: "The plan was created, and the request to start it was not readable",
      because: `${PLAN_EXISTS}${NOT_STARTED} The request to start the plan did not become one the service could act on.`,
      changedBy: PRESS_AGAIN,
    },
    "request-body-too-large": {
      heading: "The plan was created, and the request to start it was too large",
      because: `${PLAN_EXISTS}${NOT_STARTED} The service holds a size limit on every request and the one that starts a plan exceeded it, which should not be possible for a request this small.`,
      changedBy: PRESS_AGAIN,
    },
    "access-audit-unavailable": {
      heading: "The plan was created, and the access trail could not record it starting",
      because: `${PLAN_EXISTS}${NOT_STARTED} Every write here is recorded, and one that cannot be recorded does not happen — that is the bargain rather than a fault in this screen.`,
      changedBy: PRESS_AGAIN,
    },
    "request-did-not-reach-the-service": {
      heading: "The plan was created, and the request to start it did not arrive",
      because: `${PLAN_EXISTS}${NOT_STARTED} The second request did not complete, so the service was never asked to start it. This is what a lost connection looks like from here.`,
      changedBy: PRESS_AGAIN,
    },
    "service-answered-with-something-unreadable": {
      heading: "The plan was created, and it is not clear whether it started",
      because: `${PLAN_EXISTS} Something came back that this screen could not read, so it will not claim the plan started and it will not claim it did not.`,
      changedBy: `${PRESS_AGAIN} Checking the plan on the patient's screen first will tell you whether it is already running.`,
    },
  }),
);

export function activationRefusalWording(refusal: string): SubmissionRefusalWording {
  const known = ACTIVATION_REFUSAL_WORDING[refusal];
  if (known !== undefined) return known;
  return {
    heading: "The plan was created, and the service refused to start it for a reason this screen has not been taught",
    because: `${PLAN_EXISTS}${NOT_STARTED} The service refused the request to start it and named the reason "${refusal}". This screen has no plain-words explanation for that one, so the reason is given as the service gave it.`,
    changedBy: `${PRESS_AGAIN} If it keeps refusing, pass that reason on to whoever supports this service.`,
  };
}

/** The refusal names this screen uses for a failure that never reached the service. */
export const TRANSPORT_REFUSALS = Object.freeze({
  didNotReach: "request-did-not-reach-the-service",
  unreadableAnswer: "service-answered-with-something-unreadable",
});
