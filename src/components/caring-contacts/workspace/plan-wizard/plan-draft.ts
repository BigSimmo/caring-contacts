// src/components/caring-contacts/workspace/plan-wizard/plan-draft.ts
//
// The half-finished sign-up, held in the browser so that a page refresh does not lose it.
//
// THE OWNER DECIDED THIS ON 2026-08-25, KNOWING THE COST (Ruling [110]). A coordinator part-way
// through signing a patient up must not lose what they typed to a refresh, and what they typed
// includes — at stage 3, which Task 8 builds against this module — the patient's name and mobile
// number. Keeping that across a refresh means writing it to storage on the clinician's machine,
// which in practice is a shared ward computer. The owner was asked twice, the second time with
// that exposure named in those words, and chose it. This module implements it; it does not
// re-open it.
//
// WHY `sessionStorage` AND NOTHING ELSE. `localStorage` outlives the tab, so a draft written there
// would leave a patient's details on a ward machine indefinitely, for whoever sits down next. The
// owner chose tab lifetime. The distinction is enforced HERE, by this module being the only place
// in the wizard that touches a storage API at all and by naming exactly one of them — a comment
// promising tab lifetime is not an enforcement, and `tests/caring-contacts-plan-draft.dom.test.tsx`
// scans this whole directory for the other name so that a later edit cannot quietly widen it.
//
// FOUR WAYS THE DRAFT GOES AWAY, and the tab closing is only one of them:
//
//   1. the tab closes — `sessionStorage`'s own lifetime, which is why it was chosen;
//   2. `clearPlanDraft()` on successful activation — Task 9 calls this the moment the plan is
//      created, and it is the one seam this module leaves that task;
//   3. `clearPlanDraft()` on abandoning the flow — the wizard's own discard control. Relying on
//      the tab closing alone means a clinician who finishes and walks away leaves the previous
//      patient's details for the next person at that machine, which is the failure the whole
//      ruling exists to prevent;
//   4. an ACCOUNT TRANSITION — the app's sign-out, session expiry and change of signed-in user
//      (2026-09-02 audit, L6). `sessionStorage` survives a sign-out and the next sign-in in the
//      same tab, so without this a coordinator who signs out mid-draft and hands the tab to a
//      colleague leaves the patient's name and mobile for whoever opens the same referral next —
//      the ruling's failure, in the one path the wizard's own controls never see. The auth
//      provider is a lib module and may not import this one, so it removes the key itself
//      (`src/lib/account-scoped-browser-state.ts` names it, and this module imports it from
//      there) and announces the transition on `window`; `clearCaringContactsBrowserState()`
//      answers that event here, dropping the cached parse and telling the wizard.
//
// A fifth is a consequence rather than a rule: reading a draft that belongs to a DIFFERENT
// referral removes it. One key holds one draft, so starting a second sign-up cannot leave the
// first one's answers sitting in storage unreferenced.
//
// EVERY FAILURE IS SILENT AND EMPTY-HANDED. A browser that refuses storage (private modes, a
// disabled-storage policy, a full quota) must not break a clinical screen, so every entry point
// here degrades to "there is no draft" rather than throwing. The wizard asks
// `planDraftStorageAvailable()` and tells the clinician which of the two is true, because a notice
// promising the page will remember is false when the browser refused.
import { PLAN_DRAFT_STORAGE_KEY, subscribeAccountTransition } from "@/lib/account-scoped-browser-state";
import { DraftConcurrencyError } from "@/lib/caring-contacts/draft-store";
import { SENDING_PREFERENCES, type SendingPreference } from "@/lib/caring-contacts/model";

import { EMPTY_PLAN_ACTIVATION, type PlanActivationDraft, type PlanSubmissionIdentity } from "./plan-activation";
import { EMPTY_PLAN_PATIENT_DETAIL, type PlanPatientDetailDraft } from "./patient-detail";
import { isPlanWizardStage, type PlanWizardStage } from "./stages";

/**
 * The one key. Deliberately ONE, rather than one per referral:
 *
 *   * a single key is a single thing to clear, so "cleared on abandoning" is provable rather than
 *     a sweep over keys that a later stage could add to and forget;
 *   * a per-referral key would put a referral id in a storage key. A referral id in a URL is
 *     acceptable (Ruling [111]) and this would probably be too, but the draft it keys holds the
 *     patient's name and mobile number from stage 3 onward, and a key is the part of storage that
 *     is enumerable without reading the value.
 *
 * The referral the draft belongs to travels INSIDE the value instead, where `readPlanDraft` checks
 * it.
 *
 * Defined beside the auth provider's account-transition clear (way 4 above), which must remove the
 * key without importing this module; re-exported here so the wizard and its tests keep one name.
 */
export { PLAN_DRAFT_STORAGE_KEY };

/**
 * The coordinator's own confirmations at stage 1.
 *
 * Ruling [112]: these are NOT imported facts. A `Referral` is five fields and carries neither a
 * patient's name nor a mobile number, so nothing about the patient's agreement or their phone can
 * be read from one. They are what the coordinator says, in this session, and the screen says so.
 *
 * A DRAFT IS WHERE THEY LIVE UNTIL THE PLAN IS CREATED, AND NOT AFTERWARDS. Task 7 found there was
 * no field for either of them anywhere and reported it rather than inventing a storage location;
 * Task 9b added one. `createPlanSchema` now carries them, and creating the plan records an
 * attestation for each — that the coordinator confirmed this check, and when. So a tick here is
 * held on this computer until the sign-up finishes or is discarded, exactly as before, and what
 * outlives the sign-up is the attestation on the plan rather than the draft.
 *
 * What the plan records is the CONFIRMATION, never the thing confirmed: it can say a coordinator
 * confirmed the patient's agreement, and it cannot say the patient consented.
 */
export type PlanDraftAssurances = {
  /** The patient agreed to receive caring contacts. Not consent to treatment, and not legal consent. */
  patientAgreed: boolean;
  /** The mobile number this plan will use is the patient's own, and they are content to receive text on it. */
  mobileIsPatientControlled: boolean;
};

/**
 * The two confirmations the wizard's own decision overlays record, and the ONLY place they are held.
 *
 * NAME THE DESTINATION, NOT THE ACT. These are held on this computer for this tab and are written
 * onto NO plan. `createPlanSchema` carries `assurances` — the two stage-1 ticks Task 9b gave a field
 * to — and it carries nothing for either of these. The screens that record them say exactly that in
 * place, because "recorded" alone would let a coordinator read a tab's storage as the patient's
 * record, and this system distinguishes the two while ordinary English does not.
 *
 * THAT NO DOMAIN FIELD EXISTS IS A FINDING, NOT AN INVENTION. Task 7 hit the identical shape for the
 * stage-1 confirmations, reported it rather than inventing a storage location, and the owner later
 * added one. These follow that precedent: the draft is the wizard's own state, so holding them here
 * is honest, and adding a column to a sealed schema on a screen's say-so would not be.
 */
export type PlanDraftDecisions = {
  /**
   * `verify-identity`: the coordinator compared the person this sign-up is for against the invented
   * source record before going any further.
   */
  identityChecked: boolean;
  /**
   * `communication-preference`: the sending preference chosen at stage 3 is one the patient gave
   * through the staffed programme phone, rather than one the coordinator chose for them.
   */
  preferenceGivenOnStaffedLine: boolean;
};

export const NO_PLAN_DRAFT_DECISIONS: PlanDraftDecisions = Object.freeze({
  identityChecked: false,
  preferenceGivenOnStaffedLine: false,
});

/**
 * What the wizard holds between stages.
 *
 * `parseDraft` below validates field by field and treats anything it does not fully recognise as
 * an unusable draft, so a draft stored by an earlier build is discarded rather than half-read.
 * A field added to this type and NOT to that parser is silently dropped on every reload.
 *
 * STAGE 3'S FIELDS ARE THE ONES THIS WHOLE MODULE'S CAUTION IS ABOUT. `patientDetail` holds a
 * patient's name and mobile number, on what in practice is a shared ward computer. Everything in
 * Ruling [110] — one key, tab lifetime, cleared on both exits, and the notice that says so in
 * plain words — exists for this field rather than for a pair of checkboxes.
 */
export type PlanDraft = {
  /** Which accepted referral this sign-up is for. Checked on read; never a patient identifier. */
  referralId: string;
  stage: PlanWizardStage;
  assurances: PlanDraftAssurances;
  /** The pathway version this plan will run, or null while nothing has been chosen. */
  pathwayVersionId: string | null;
  /** Stage 3's typed values, as typed. See `patient-detail.ts` for why they are held verbatim. */
  patientDetail: PlanPatientDetailDraft;
  /**
   * When in the day every contact in this plan goes out, or null while nothing has been chosen.
   *
   * Null rather than a default. Nothing in this domain carries a sending preference, so defaulting
   * to "morning" would decide when a discharged patient hears from the service and then present
   * that decision as the coordinator's. Stage 2's pathway starts filled only because a referral
   * genuinely does carry one (Ruling [113]).
   */
  sendingPreference: SendingPreference | null;
  /**
   * Stage 4's typed values: the discharge day, the first-contact day, and the reason a moved day
   * carries (Rulings [118] and [121]). Held verbatim, for the same reason stage 3's are.
   */
  activation: PlanActivationDraft;
  /**
   * The plan identifier and idempotency key this sign-up will submit with, or null until stage 4
   * is reached.
   *
   * RULING [120], AND IT IS WHY THEY LIVE IN THE DRAFT RATHER THAN IN THE COMPONENT. They are
   * minted once and reused for every retry of the same submission, and a retry can follow a page
   * refresh -- a clinician whose Activate timed out reloads and presses it again. React state
   * would not survive that; this does. Minted fresh per attempt, the second press creates a SECOND
   * PLAN FOR ONE PATIENT: two schedules, two sets of messages. Reused, it is refused as a replay
   * and returns the first attempt's own answer.
   *
   * Null on a fresh draft rather than minted with it, because a sign-up abandoned at stage 1 never
   * reached the stage that creates anything and should mint no plan identifier at all.
   */
  submission: PlanSubmissionIdentity | null;
  /**
   * What the wizard's own decision overlays have recorded. Held here and written onto no plan —
   * see {@link PlanDraftDecisions}.
   */
  decisions: PlanDraftDecisions;
  /**
   * The optimistic-concurrency counter (#M6P1QQ), incremented by `writePlanDraft` on every
   * successful write. `0` on a draft that has never been written.
   *
   * `sessionStorage` belongs to one tab, so the ordinary meaning of "two sessions" `DraftStore` was
   * built for cannot happen here — but a single tab is not single-writer. `update()` in
   * `plan-wizard.tsx` closes over the draft its OWN render read, and React can flush more than one
   * effect from the same commit before that render's `draft` closure is replaced by a newer one
   * (the stage-4 submission-mint effect and an ordinary field edit both do this). Two writes built
   * from the same stale closure silently overwrite each other today — the second simply replaces
   * whatever the first just wrote, with nothing to notice. This field, and the check in
   * `writePlanDraft`, exist to catch exactly that and re-base rather than lose it — see
   * `writeDraftWithRetry` in `plan-wizard.tsx`.
   */
  version: number;
};

/**
 * A fresh draft for one referral.
 *
 * `pathwayVersionId` starts at whatever the referral already names (Ruling [113]) rather than at
 * null: an accepted referral can carry a pathway chosen by whoever accepted it, and starting from
 * an empty choice would present that decision as though it had never been made.
 */
export function emptyPlanDraft(referralId: string, pathwayVersionId: string | null): PlanDraft {
  return {
    referralId,
    stage: "agreement",
    assurances: { patientAgreed: false, mobileIsPatientControlled: false },
    pathwayVersionId,
    patientDetail: { ...EMPTY_PLAN_PATIENT_DETAIL },
    sendingPreference: null,
    activation: { ...EMPTY_PLAN_ACTIVATION },
    submission: null,
    decisions: { ...NO_PLAN_DRAFT_DECISIONS },
    version: 0,
  };
}

/**
 * The tab-scoped store, or null when this browser will not give one.
 *
 * `window.sessionStorage` is the ONLY storage API named in this module, and the only one this
 * directory may name at all. Accessing it throws outright in some privacy configurations, so even
 * the access is guarded.
 */
function tabScopedStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Whether a draft can be kept at all. The wizard states which answer it got, in place. */
export function planDraftStorageAvailable(): boolean {
  return tabScopedStorage() !== null;
}

/*
 * THE DRAFT IS AN EXTERNAL STORE, AND THE WIZARD SUBSCRIBES TO IT.
 *
 * The obvious shape was React state plus a `useEffect` that restored the draft after mount. It was
 * written that way first and `react-hooks/set-state-in-effect` rejected it, correctly: an effect
 * that immediately sets state causes a cascading render, and the rule's own advice is to subscribe
 * to the external system instead. The deeper reason is the one that matters here, though — a lazy
 * `useState` initialiser reading `sessionStorage` would have produced a HYDRATION MISMATCH, because
 * the server render cannot see the browser's storage and the client's first render can. On this
 * screen the mismatch would have been about a patient's details.
 *
 * `useSyncExternalStore` is built for exactly that: `planDraftServerSnapshot` answers null on the
 * server and during hydration, and the real snapshot arrives in the commit that follows. So the
 * three functions below are the store's subscribe/getSnapshot/getServerSnapshot, and the rules a
 * snapshot must obey shape them:
 *
 *   * IT MUST BE REFERENTIALLY STABLE while nothing has changed. Parsing the stored JSON on every
 *     call would return a new object each time and spin React forever, so the parse is cached
 *     against the raw string it came from.
 *   * IT MUST BE PURE. No clearing, no writing, no repair — `readPlanDraft` still does the
 *     referral-mismatch clearing, and the wizard calls that from an effect where a side effect is
 *     legitimate.
 *
 * WHEN THE BROWSER REFUSES STORAGE the draft lives in `memoryDraft` instead. Without it a clinician
 * in a private window could not tick a checkbox at all: every write would go nowhere, the snapshot
 * would stay null, and the screen would never change. It lasts as long as the page does, which is
 * strictly less exposure than `sessionStorage`, and the notice says so.
 *
 * A browser refuses in TWO shapes, and they are not equally likely. Reaching `window.sessionStorage`
 * can throw outright, which is the rare configuration; far commoner — and what Safari private
 * browsing does — is a storage object that exists and whose `setItem` throws. Both land in
 * `memoryDraft`, and `planDraftSnapshot` reads it before it reads storage so that both are actually
 * reachable. Round 1 finding I-1 was that only the first shape worked.
 */
type PlanDraftListener = () => void;

const listeners = new Set<PlanDraftListener>();

/** The draft when this browser will not keep one. Page lifetime, not tab lifetime. */
let memoryDraft: PlanDraft | null = null;

/** The last raw string read, and what it parsed to — the referential stability the snapshot needs. */
let cachedRaw: string | null = null;
let cachedDraft: PlanDraft | null = null;

function notifyPlanDraftListeners(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeToPlanDraft(listener: PlanDraftListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function rawDraft(storage: Storage): string | null {
  try {
    return storage.getItem(PLAN_DRAFT_STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The draft as it stands, cached so repeated calls return the same object. Pure.
 *
 * `memoryDraft` IS CONSULTED FIRST, and the order is the whole point. Review round 1, finding I-1:
 * this used to reach for memory only when `tabScopedStorage()` returned null — the browser that
 * refuses even to hand over the object. But the commoner refusal, and the one Safari private
 * browsing actually performs, is a storage object that EXISTS and whose `setItem` throws. In that
 * shape the old order re-read the empty store, returned null, and the screen never changed: every
 * tick was written to memory that nothing ever read. That is the exact dead end the fallback was
 * added to prevent, so the fallback has to be reachable from the case it exists for.
 *
 * `memoryDraft` is non-null only while the last write failed to land in storage — a successful
 * write and `clearPlanDraft` both null it — so preferring it can never shadow a newer stored draft.
 */
export function planDraftSnapshot(): PlanDraft | null {
  if (memoryDraft !== null) return memoryDraft;

  const storage = tabScopedStorage();
  if (storage === null) return null;

  const raw = rawDraft(storage);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedDraft = raw === null ? null : parseDraft(raw);
  }
  return cachedDraft;
}

/**
 * Whether this browser is actually keeping the draft.
 *
 * Not the same question as `planDraftStorageAvailable()`. Storage can exist and still refuse a
 * write — a full quota, a policy — in which case the draft is in memory and will not survive a
 * reload. The notice must say which of those is true, so it asks this rather than inferring it.
 */
export function planDraftIsHeld(): boolean {
  return tabScopedStorage() !== null && memoryDraft === null;
}

/** Null on the server and through hydration: the server cannot see a browser's storage. */
export function planDraftServerSnapshot(): PlanDraft | null {
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A stored value turned back into a draft, or null.
 *
 * Every field is checked. A draft that fails any check is not repaired and not partly used: half a
 * clinician's answers, with the other half silently defaulted, is worse than asking them again.
 */
function parseDraft(raw: string): PlanDraft | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;

  const {
    referralId,
    stage,
    assurances,
    pathwayVersionId,
    patientDetail,
    sendingPreference,
    activation,
    submission,
    decisions,
    version,
  } = parsed;
  if (typeof referralId !== "string" || referralId === "") return null;
  if (!isPlanWizardStage(stage)) return null;
  if (!isRecord(assurances)) return null;
  if (typeof assurances.patientAgreed !== "boolean") return null;
  if (typeof assurances.mobileIsPatientControlled !== "boolean") return null;
  if (pathwayVersionId !== null && typeof pathwayVersionId !== "string") return null;
  const detail = parsePatientDetail(patientDetail);
  if (detail === null) return null;
  if (sendingPreference !== null && !isSendingPreference(sendingPreference)) return null;
  const activationDraft = parseActivation(activation);
  if (activationDraft === null) return null;
  const submissionIdentity = parseSubmission(submission);
  if (submissionIdentity === undefined) return null;
  const recordedDecisions = parseDecisions(decisions);
  if (recordedDecisions === null) return null;
  // ABSENT MEANS "WRITTEN BEFORE THIS FIELD EXISTED", not "the clinician's answer was zero" —
  // unlike stage 3 and stage 4's fields, a version counter has no clinical meaning, so a draft from
  // before #M6P1QQ is not refused or made to lose the patient's details over it. Treated the same
  // as a freshly-started draft would be: the very next `writePlanDraft` establishes version 1.
  const parsedVersion = typeof version === "number" && Number.isFinite(version) && version >= 0 ? version : 0;

  return {
    referralId,
    stage,
    assurances: {
      patientAgreed: assurances.patientAgreed,
      mobileIsPatientControlled: assurances.mobileIsPatientControlled,
    },
    pathwayVersionId,
    patientDetail: detail,
    sendingPreference,
    activation: activationDraft,
    submission: submissionIdentity,
    decisions: recordedDecisions,
    version: parsedVersion,
  };
}

/**
 * The wizard's own recorded decisions, or null when the stored value is a shape this module does
 * not recognise.
 *
 * ABSENT IS ACCEPTED AND MEANS NEITHER WAS RECORDED, and that is the opposite treatment from
 * `parseActivation` and `parsePatientDetail` above, so the difference is worth stating rather than
 * inheriting. Those two refuse a draft missing their fields because absence there is AMBIGUOUS: a
 * missing `patientName` could be a clinician who typed nothing or a draft older than the stage, and
 * guessing between them silently defaults half a clinician's answers.
 *
 * Absence here is not ambiguous. Neither decision has a default a clinician could have meant, and
 * the only reading of "this key is not present" is "these decisions had not been offered when this
 * draft was written". Reading it as `false` under-claims in the one direction that is safe — it can
 * never say a check happened that did not — where REFUSING the draft would throw away the patient's
 * name and mobile number the clinician typed, to remove two confirmations they were never shown.
 *
 * A key that IS present and is not two booleans is refused outright, because that is a value this
 * module did not write and cannot read.
 */
function parseDecisions(value: unknown): PlanDraftDecisions | null {
  if (value === undefined) return { ...NO_PLAN_DRAFT_DECISIONS };
  if (!isRecord(value)) return null;
  const { identityChecked, preferenceGivenOnStaffedLine } = value;
  if (typeof identityChecked !== "boolean") return null;
  if (typeof preferenceGivenOnStaffedLine !== "boolean") return null;
  return { identityChecked, preferenceGivenOnStaffedLine };
}

/**
 * Stage 4's three fields, or null if any is missing or the wrong type.
 *
 * Every field is REQUIRED to be present as a string, including the two that may legitimately be
 * empty, for the reason `parsePatientDetail` records below: a draft written before stage 4 existed
 * carries none of them, and reading that as "the clinician entered nothing" would be a guess about
 * a record this module cannot see the age of.
 */
function parseActivation(value: unknown): PlanActivationDraft | null {
  if (!isRecord(value)) return null;
  const { dischargeDay, firstContactDay, firstContactReason } = value;
  if (typeof dischargeDay !== "string") return null;
  if (typeof firstContactDay !== "string") return null;
  if (typeof firstContactReason !== "string") return null;
  return { dischargeDay, firstContactDay, firstContactReason };
}

/**
 * The minted plan identity, `null` when none has been minted, or `undefined` when the stored value
 * is not one this module recognises.
 *
 * THREE ANSWERS RATHER THAN TWO, and the reason is Ruling [120] rather than tidiness. `null` is a
 * legitimate stored state -- a sign-up that has not reached stage 4 has minted nothing -- so it
 * cannot also be the way this function reports a value it refuses. `undefined` is the refusal, and
 * the caller discards the whole draft on it.
 *
 * PART OF AN IDENTITY IS REFUSED OUTRIGHT rather than repaired by minting the missing piece. The
 * three together are the retry contract: a plan id without its create key, or either key without
 * the plan id, would submit a write whose replay could not be recognised, which is the exact
 * condition that creates two plans for one patient. A missing ACTIVATE key is the same failure one
 * write later -- the plan is created and can never be started.
 */
function parseSubmission(value: unknown): PlanSubmissionIdentity | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const { planId, createIdempotencyKey, activateIdempotencyKey } = value;
  if (typeof planId !== "string" || planId === "") return undefined;
  if (typeof createIdempotencyKey !== "string" || createIdempotencyKey === "") return undefined;
  // THE THIRD VALUE IS REQUIRED TOO, and it is the one a draft written before Ruling [123] lacks.
  // Accepting a two-key identity would leave the second write with no key of its own on exactly the
  // drafts most likely to be mid-flight during a redeploy.
  if (typeof activateIdempotencyKey !== "string" || activateIdempotencyKey === "") return undefined;
  return { planId, createIdempotencyKey, activateIdempotencyKey };
}

/**
 * Stage 3's fields, or null if any is missing or the wrong type.
 *
 * Every field is REQUIRED to be present as a string, including those that may legitimately be
 * empty. A draft written before stage 3 existed carries none of them, and reading it as "the
 * clinician typed nothing" would be a guess about a record this module cannot see the age of. The
 * module's own rule applies: half a clinician's answers with the other half silently defaulted is
 * worse than asking again.
 *
 * `preferredName` (2026-08-26) is required on exactly that rule, and the consequence is stated
 * rather than softened: a draft written before the field existed is DISCARDED, taking the name and
 * mobile number with it, and the clinician is asked all three again. Defaulting it to `""` would be
 * indistinguishable from a clinician who deliberately left it blank, and the value decides the word
 * a patient-visible message opens with. Cultural identity is blanked rather than refused for the
 * opposite reason: nothing may supply it any more, so there is nothing to ask for.
 */
function parsePatientDetail(value: unknown): PlanPatientDetailDraft | null {
  if (!isRecord(value)) return null;
  const { patientName, preferredName, patientMobileNumber, patientIdentifiers, culturalIdentity } = value;
  if (typeof patientName !== "string") return null;
  if (typeof preferredName !== "string") return null;
  if (typeof patientMobileNumber !== "string") return null;
  if (typeof patientIdentifiers !== "string") return null;
  if (typeof culturalIdentity !== "string") return null;
  // BLANKED, NEVER CARRIED THROUGH — round 2, finding N-1. Stage 3 stopped offering an input for
  // cultural identity (owner decision, 2026-08-25), but a draft written before that change survives
  // in the same tab across a redeploy, and reading it back intact would let Task 9 submit a value
  // into `cultural_identity_reports` while the screen says the plan records nothing there.
  //
  // BLANKED RATHER THAN REFUSED, deliberately. Returning null here would discard the whole draft —
  // throwing away the patient's name and mobile number the clinician typed, to remove a field they
  // were never offered. Blanking drops exactly the value that may no longer be supplied and keeps
  // everything they did type. The key is still REQUIRED to be a string above, so this is a decision
  // about a recognised field rather than a silence about an unrecognised one.
  return { patientName, preferredName, patientMobileNumber, patientIdentifiers, culturalIdentity: "" };
}

/**
 * Whether a stored value is one of the three approved sending preferences.
 *
 * Checked against the sealed domain's own `SENDING_PREFERENCES` rather than a list written out
 * here. A local list would be a second copy of the union, free to go on accepting a preference the
 * domain had dropped — and the value being checked came out of a browser's storage, so it is
 * exactly the kind of value that can be older than the code reading it.
 */
function isSendingPreference(value: unknown): value is SendingPreference {
  return (SENDING_PREFERENCES as readonly string[]).includes(value as string);
}

/**
 * The draft held for `referralId`, or null.
 *
 * A stored draft belonging to a different referral is REMOVED rather than ignored. Ignoring it
 * would leave one coordinator's answers — and, from stage 3, one patient's name and number — in
 * storage for the rest of the tab's life, referenced by nothing.
 */
export function readPlanDraft(referralId: string): PlanDraft | null {
  const draft = planDraftSnapshot();
  if (draft === null) {
    // Present but unreadable: an older shape, or something that was tampered with. Removed rather
    // than left sitting there — it is nobody's draft now, and it may still hold a patient's details.
    if (storageHoldsAValue()) clearPlanDraft();
    return null;
  }
  if (draft.referralId !== referralId) {
    clearPlanDraft();
    return null;
  }
  return draft;
}

function storageHoldsAValue(): boolean {
  const storage = tabScopedStorage();
  return storage !== null && rawDraft(storage) !== null;
}

export type WritePlanDraftOptions = {
  /**
   * The version this write was computed FROM — pass the `version` of whatever draft `draft` is an
   * edit of (typically `draft.version` itself, from before the caller applied its own change).
   * Compared against what is ACTUALLY held right now, read fresh inside this call rather than
   * trusted from the caller, immediately before writing. A mismatch throws
   * `DraftConcurrencyError<PlanDraft>` instead of silently letting this write clobber one that
   * landed first — see `PlanDraft.version`'s own note for the race this catches.
   *
   * Optional so every pre-#M6P1QQ call site keeps compiling unchanged; omitting it keeps today's
   * blind-overwrite behaviour for that call site. `plan-wizard.tsx`'s `writeDraftWithRetry` is the
   * one place this should be omitted from going forward -- every write the wizard itself makes goes
   * through it.
   */
  expectedVersion?: number;
};

/**
 * Whether the draft was actually written down. The wizard's notice states which answer it got.
 *
 * Always writes the draft ACTUALLY held now, version-bumped by one -- `draft.version` itself is
 * never trusted as the number to write, only (optionally, via `options.expectedVersion`) as proof
 * the caller last saw the version this write is about to replace.
 *
 * @throws DraftConcurrencyError<PlanDraft> when `options.expectedVersion` is given and does not
 * match the version actually held for `draft.referralId` right now.
 */
export function writePlanDraft(draft: PlanDraft, options?: WritePlanDraftOptions): boolean {
  const current = planDraftSnapshot();
  const heldVersion = current !== null && current.referralId === draft.referralId ? current.version : 0;

  if (options?.expectedVersion !== undefined && options.expectedVersion !== heldVersion) {
    throw new DraftConcurrencyError<PlanDraft>(draft.referralId, options.expectedVersion, heldVersion, current);
  }

  const toWrite: PlanDraft = { ...draft, version: heldVersion + 1 };

  const storage = tabScopedStorage();
  if (storage === null) {
    memoryDraft = toWrite;
    notifyPlanDraftListeners();
    return false;
  }
  const serialised = JSON.stringify(toWrite);
  try {
    storage.setItem(PLAN_DRAFT_STORAGE_KEY, serialised);
  } catch {
    // Storage exists but would not take this write (a full quota, a policy). The draft still has to
    // work for the rest of this page, and the notice still has to say it is not being kept.
    memoryDraft = toWrite;
    notifyPlanDraftListeners();
    return false;
  }
  // The cache is primed from what was just written rather than left to be re-read and re-parsed:
  // the snapshot must be referentially stable, and a fresh parse would hand React a new object.
  cachedRaw = serialised;
  cachedDraft = toWrite;
  memoryDraft = null;
  notifyPlanDraftListeners();
  return true;
}

/**
 * Removes the draft.
 *
 * THE SEAM TASK 9 MUST CALL. A plan that has just been activated has taken everything the draft
 * held; leaving it behind means the next person at that machine, in that tab, finds the previous
 * patient's details. Call this the moment `createPlan` returns success, before anything navigates.
 *
 * Also what the wizard's discard control calls, and what `readPlanDraft` calls when the stored
 * draft belongs to another referral.
 */
export function clearPlanDraft(): void {
  memoryDraft = null;
  cachedRaw = null;
  cachedDraft = null;
  const storage = tabScopedStorage();
  if (storage !== null) {
    try {
      storage.removeItem(PLAN_DRAFT_STORAGE_KEY);
    } catch {
      // Nothing to recover and nothing to tell the clinician that the notice does not already say.
    }
  }
  notifyPlanDraftListeners();
}

/**
 * Whether a draft differs from the initial empty draft for that referral.
 *
 * Used by the tab-close dirty-state guard to attach `beforeunload`
 * strictly when a coordinator has actively modified in-progress clinical details.
 */
export function isPlanDraftDirty(
  draft: PlanDraft | null,
  referralId: string,
  referralPathwayVersionId: string | null,
): boolean {
  if (draft === null || draft.referralId !== referralId) return false;
  if (draft.stage !== "agreement") return true;
  if (draft.assurances.patientAgreed || draft.assurances.mobileIsPatientControlled) return true;
  if (draft.pathwayVersionId !== referralPathwayVersionId) return true;
  if (draft.patientDetail.patientName.trim() !== "") return true;
  if (draft.patientDetail.preferredName.trim() !== "") return true;
  if (draft.patientDetail.patientMobileNumber.trim() !== "") return true;
  if (draft.patientDetail.patientIdentifiers.trim() !== "") return true;
  if (draft.sendingPreference !== null) return true;
  if (draft.activation.dischargeDay.trim() !== "") return true;
  if (draft.activation.firstContactDay.trim() !== "") return true;
  if (draft.activation.firstContactReason.trim() !== "") return true;
  if (draft.decisions.identityChecked || draft.decisions.preferenceGivenOnStaffedLine) return true;
  return false;
}

/**
 * Everything Caring Contacts keeps in this browser for the signed-in person — today, the draft.
 *
 * THE ACCOUNT-BOUNDARY SEAM, answering the auth provider's transition event at sign-out, session
 * expiry and a change of signed-in user (way 4 above). It is a separate name from `clearPlanDraft`
 * so that a later store this workspace adds to the browser is cleared by adding it HERE, where the
 * account boundary already reaches, rather than by teaching the provider a second thing. The
 * provider has already removed the stored key by the time this runs — it cannot import this module
 * — so what is left to do is drop the cached parse and the in-memory fallback and tell the wizard.
 * Registered at module load so a cache filled by an earlier mount does not outlive the transition.
 */
export function clearCaringContactsBrowserState(): void {
  clearPlanDraft();
}

subscribeAccountTransition(clearCaringContactsBrowserState);
