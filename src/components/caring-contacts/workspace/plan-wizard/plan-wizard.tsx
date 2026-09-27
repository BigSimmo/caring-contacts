"use client";

import {
  CalendarDays,
  CircleAlert,
  ClipboardCheck,
  FileCheck2,
  IdCard,
  MessageSquareText,
  PhoneOff,
  ShieldCheck,
  Trash2,
  UserRoundCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useDirtyStateGuard } from "@/components/ui/use-dirty-state-guard";
import { CARING_CONTACTS_ROUTES, patientPlanRoute } from "@/lib/caring-contacts-routes";
import { DraftConcurrencyError } from "@/lib/caring-contacts/draft-store";
import type { SendingPreference } from "@/lib/caring-contacts/model";
import type { ReferralIntakePayload } from "@/lib/caring-contacts/referral-intake";
import {
  FIRST_CONTACT_REASON_MAX_LENGTH,
  firstContactDayBounds,
  type SendingPreferenceOption,
} from "@/lib/caring-contacts/schedule";

import { AutomatedState } from "../automated-state";
import { awstDateWording } from "../date-wording";
import { ListEmptyState } from "../list-empty-state";
import { MobileConfirmationFields, type MobileNumberCheck, useMobileNumberCheck } from "../mobile-number-check";
import { ExitOnlyOverlayTrigger } from "../overlays/exit-only-overlay-trigger";
import type { WorkspaceOverlayCommit } from "../overlays/overlay-commits";
import { WorkspaceOverlayTrigger } from "../overlays/overlay-trigger";
import { carriedFromIntake, IntakeClinicalBanner, intakePatientName, seedDraftFromIntake } from "./intake-seed";
import { wizardDecisionRefusal, type WizardDecisionState } from "./overlay-guards";
import {
  createPlanPatientDetail,
  mobileIsDesignatedFictional,
  mobileNumberProblem,
  parsePatientIdentifiers,
  type PersonalisationField,
  personalisationIssues,
  type PlanPatientDetailDraft,
} from "./patient-detail";
import {
  activatePlanRequestBody,
  activationRefusalWording,
  createPlanRequestBody,
  dischargeDayBounds,
  everyAssuranceConfirmed,
  firstContactConsequence,
  firstContactReasonIsRequired,
  mintPlanSubmissionIdentity,
  type PlanActivationDraft,
  PLANNED_MESSAGE_TYPE_LABELS,
  plannedScheduleSentence,
  planSchedulePreview,
  type PlanSchedulePreview,
  type PlanSubmissionIdentity,
  planVersionFromCreateAnswer,
  submissionRefusalWording,
  TRANSPORT_REFUSALS,
  unconfirmedAssuranceSentence,
} from "./plan-activation";
import {
  clearPlanDraft,
  emptyPlanDraft,
  isPlanDraftDirty,
  type PlanDraft,
  type PlanDraftAssurances,
  planDraftIsHeld,
  planDraftServerSnapshot,
  planDraftSnapshot,
  readPlanDraft,
  subscribeToPlanDraft,
  writePlanDraft,
} from "./plan-draft";
import { type PlanWizardStage, planWizardStageImplementation, previousPlanWizardStage } from "./stages";
import { StatedReason } from "./stated-reason";
import { Stepper, UnbuiltStagePanel } from "./wizard-chrome";
import { DateField, ForwardControl, RefusalStatement, SourcedFact, TextAreaField, TextField } from "./wizard-fields";
import {
  fieldClass,
  headingClass,
  mutedTextClass,
  optionLabelClass,
  optionRowClass,
  panelClass,
  primaryControlClass,
  secondaryControlClass,
} from "./wizard-styles";
import { decisionRefusalHeading, identityFacts, refusalNameFrom } from "./wizard-wording";

/**
 * Putting a discharged patient onto a caring-contact plan: agreement, pathway, personalisation,
 * review and activation.
 *
 * THE FIRST DELIBERATE CLIENT COMPONENT IN THIS WORKSPACE (Ruling [109])
 * ---------------------------------------------------------------------
 * Every other screen here is a Server Component and works with JavaScript turned off; Tasks 5 and
 * 6 both reached a full filter-and-search screen with no client boundary at all. This one cannot,
 * and the reason is an owner decision rather than convenience: a half-finished sign-up must
 * survive a page refresh, which neither a Server Component nor a URL parameter can do. And a URL
 * parameter is independently forbidden for this data — `src/app/api/caring-contacts/plans/route.ts`
 * records why in the code, and stage 3 is where the patient's name and mobile number arrive.
 *
 * Ruling 13 holds this workspace's client payload to a rounding error, not to zero, and the
 * licence is for this route only. The page above stays a Server Component: it makes the audited
 * reads, fails closed on every bad outcome, and loads this behind the same lazy `dynamic()`
 * boundary the workspace's other routes use, so nothing here enters another route's chunk.
 *
 * THE SERVICE STATE NEVER CROSSES THIS BOUNDARY, and that constraint is absolute. `ServiceState`
 * carries a free-text incident `note` that the server surface gates behind `viewPatientRecord`;
 * this component takes no service state, no note, and nothing derived from either. The safety
 * banner is the shell's, rendered on the server, above this. `tests/caring-contacts-new-plan-page.dom.test.tsx`
 * pins that the page hands this component no such prop, because "the wizard is exactly where it
 * would be easiest to leak" is a prediction, not a guarantee.
 *
 * WHAT IS BUILT HERE
 * ------------------
 * All four stages. Task 7 built the shell and stages 1 and 2, Task 8 stage 3, Task 9 stage 4 —
 * review and activation, the only stage that WRITES. `stages.ts`'s `not-built` variant is therefore
 * returned by nothing, and `UnbuiltStagePanel` and `ForwardControl`'s unavailable branch are
 * unreached rather than dead: they are the extension point a fifth stage would use, and Ruling 52
 * is what they implement.
 *
 * THE OVERLAYS WIRED HERE (Task 9 wired the first; Task 11a wired the rest). `final-activation` is
 * the confirmation in front of the write, and Task 9 built it because a control that writes with no
 * confirmation step is not something to ship and fix later. Task 11a then wired the seven the
 * approved mockup opens from these stages: `verify-identity` and `change-patient` at stage 1,
 * `pathway-preview` at stage 2, and `message-preview`, `communication-preference`, `save-draft` and
 * `discard-changes` at stage 3. `adjust-date-time` and `outside-window-warning` are still unwired
 * seams, named in the Task 8 and 9 reports.
 *
 * EVERY MUTATING ONE RECHECKS AT COMMIT TIME, WHICH IS NOT THE SAME AS AT OPEN TIME. The trigger
 * stages its commit when it is activated, so a closure capturing this render's `draft` would write
 * that draft back over whatever the tab holds when the decision is finally confirmed — including
 * recreating a draft another part of the tab had removed, with a patient's name and mobile number
 * in it. `overlay-guards.ts` holds the predicate and this component asks it twice: once at render,
 * to decide whether the trigger's commit is `{ kind: "unavailable" }`, and once inside the commit
 * from values read at that moment. A refusal at the second point changes nothing at all.
 */
/**
 * Identifies the provenance line at stage 2, so a test can assert the ELEMENT is absent rather than
 * only its text.
 *
 * That distinction is not pedantry: it was found by a surviving mutant. Removing the `=== null`
 * condition renders the paragraph for every option, and a null note renders as an EMPTY paragraph —
 * so a case asserting "this wording is not on the screen" passed against a screen that had gained an
 * element for every version. The negative case now asserts on this handle.
 */
export const PATHWAY_PROVENANCE_TESTID = "caring-contacts-pathway-provenance";

export type PlanWizardPathwayOption = {
  id: string;
  /** The pathway's own cadence wording, taken from its frozen snapshot. Never written here. */
  cadenceLabels: readonly string[];
  /**
   * Which approval seats are recorded against this version, ALREADY IN PLAIN WORDS — the page
   * resolves them through `PATHWAY_APPROVAL_ROLE_WORDING` in `@/lib/caring-contacts/pathway-versions`
   * (round 1, M-2). Governance provenance, not a tally.
   */
  approvedBy: readonly string[];
  /**
   * Plain words qualifying where those approvals came from, or null when the record claims nothing.
   *
   * Non-null ONLY for a version whose own snapshot carries a provenance (Ruling [126]); the page
   * resolves it through `pathwayVersionProvenanceWording`, exactly as it resolves `approvedBy`, so
   * neither the wording nor the domain module enters this client chunk. A screen must never infer
   * this -- "Approved by ..." is a claim about provenance, and only the record knows.
   *
   * It is a resolver rather than a map lookup because the lookup failed in the unsafe direction: a
   * provenance this build does not recognise -- reachable through the Postgres reader's unchecked
   * cast -- yielded `undefined`, and `=== null` below is then false, so the qualifier rendered
   * empty beside an approval left standing. The resolver returns `null` or a string, never
   * `undefined`, which is what makes the test below safe to write.
   */
  provenanceNote: string | null;
  /** AWST instant this version was published, or null. */
  publishedAt: string | null;
};

export type PlanWizardProps = {
  /** The accepted referral this sign-up is for. Validated by the page before it reaches here. */
  referralId: string;
  /** The synthetic patient identifier the referral names. Never a patient's name. */
  patientId: string;
  /** The team that accepted the referral. */
  teamId: string;
  /** Who is acting. Read from the session, not from the referral. */
  actorId: string;
  /** The acting role(s), already in plain words. Never the raw identifier. */
  actorRoleLabels: readonly string[];
  /**
   * The pathway version the referral already names, or null (Ruling [113]). An accepted referral
   * can carry a pathway chosen by whoever accepted it, and stage 2 says so rather than presenting
   * an empty choice as though nothing had been decided.
   */
  referralPathwayVersionId: string | null;
  /** The approved versions this actor may choose between. Read on the server. */
  pathwayOptions: readonly PlanWizardPathwayOption[];
  /**
   * The three sending preferences with the AWST time each actually sends at, resolved on the server
   * from `SENDING_PREFERENCE_OPTIONS` in `@/lib/caring-contacts/schedule`.
   *
   * PASSED IN RATHER THAN IMPORTED HERE, for the reason round 1 finding M-2 settled: the send hour
   * is the schedule module's rule, and a time written beside a radio button in this file would be a
   * second copy of it — free to go on saying 10:00 after the hour moved, on the screen where a
   * coordinator decides when a discharged patient hears from the service. Resolving it on the
   * server also keeps that module out of this route's client chunk.
   */
  sendingPreferenceOptions: readonly SendingPreferenceOption[];
  /**
   * The reserved fictional patient mobiles (`synthetic-contacts.ts`), resolved on the server.
   *
   * Stage 3 uses them to STATE which numbers this prototype's own material uses, and to say when
   * the number typed is not one of them. It never refuses a value: this domain holds no format rule
   * for a mobile number at all (`createPlanSchema` takes `z.string().min(1)`), so a refusal here
   * would be an authority invented on this screen and enforced nowhere else.
   */
  fictionalPatientMobileNumbers: readonly string[];
  /**
   * The patient-visible wording the `message-preview` row shows, READ FROM THE SEALED DOMAIN and
   * resolved on the server (`EXACT_PATIENT_VISIBLE_MESSAGE` in `@/lib/caring-contacts/message-copy`).
   *
   * PASSED IN RATHER THAN IMPORTED, for the two reasons the props above it were. A screen may not
   * author or alter patient-visible wording — a hardcoded copy would be a defect even with the
   * string correct, because it puts the owner's pending decisions in two places — and resolving it
   * on the server keeps `message-copy.ts` and the GSM-7 machinery it pulls in out of this route's
   * client chunk.
   *
   * A PLAIN STRING, AND THIS SCREEN ASSUMES NOTHING ABOUT ITS SHAPE. The wording is changing: the
   * owner has decided it gains a slot for the patient's first name, and that work is being done in
   * the sealed domain. Whatever arrives here is rendered as it arrives. Nothing here assembles a
   * greeting, interpolates a name, or reads the string apart — see the panel that renders it for
   * what this screen therefore cannot yet promise.
   */
  patientVisibleMessageSpecimen: string;
  /**
   * H-44 intake clinical payload round-tripped from the audited store for this referral, or null
   * when the referral was created without one. Used to prefill patient detail and surface safety
   * alerts — never an HTTP-response echo of discarded fields.
   */
  intakePrefill?: ReferralIntakePayload | null;
};

/**
 * The mobile field's caution region. One constant because three places name it: the region's own
 * `id`, the input's `aria-describedby`, and the test that proves the region exists before it has
 * anything to say (round 1, I-2).
 */
const MOBILE_CAUTION_ID = "caring-contacts-patient-mobile-caution";

/**
 * Where `save-draft` takes a coordinator, in the words the screen owes the matrix's Navigation
 * clause -- and in ONE place, because the control's accessible name and the sentence beside it must
 * not be able to drift apart.
 *
 * The frozen drawer says "Save this activation draft" / "Save draft" / "The draft is kept as it
 * stands. Nothing is sent and no plan starts." Not one of those mentions leaving this screen, and
 * they are the approved copy, so the announcement lives here instead of being edited into them.
 */
const SAVE_DRAFT_DESTINATION = "keeps this sign-up on this computer and takes you to this team's plans";

/**
 * The plan collection, which is where the FIRST of this screen's two writes goes.
 *
 * A path literal, and these two are the ONLY exception to "hrefs come from
 * `caring-contacts-routes.ts`", because that module declares PAGE destinations a clinician
 * navigates to and these are API routes nothing links to. `plans/route.ts` and
 * `plans/[planId]/route.ts` are where the contracts live; the bodies they accept are assembled in
 * exactly one place each (`createPlanRequestBody`, `activatePlanRequestBody`), so a field added to
 * either contract is an additive change there rather than a hunt through this component.
 */
const CREATE_PLAN_ENDPOINT = "/api/caring-contacts/plans";

/** The lifecycle endpoint for one plan, which is where the second write goes. */
function startPlanEndpoint(planIdentifier: string): string {
  return `${CREATE_PLAN_ENDPOINT}/${encodeURIComponent(planIdentifier)}`;
}

/**
 * Where the pair of writes has got to (Ruling [123]).
 *
 * FIVE STATES FOR TWO WRITES, and the shape is the point: `refused` means the FIRST write failed and
 * nothing exists, `created-not-started` means the first succeeded and the second did not, and
 * `created` means both landed. Collapsing the middle one into either neighbour is the defect this
 * whole state machine exists to prevent — see its own note below.
 *
 * `created` is a state of its own rather than a flag on `idle`, because after a successful pair the
 * draft is gone and the wizard would otherwise re-render as a brand-new sign-up at stage 1 for the
 * moment before the navigation lands. A coordinator seeing the form reset would reasonably conclude
 * nothing had been created.
 */
type PlanSubmissionState =
  | { status: "idle" }
  | { status: "sending" }
  /** The first write was refused. Nothing exists, and the wording says so. */
  | { status: "refused"; refusal: string }
  /**
   * THE PLAN EXISTS AND HAS NOT STARTED -- a real, reachable, recoverable state rather than a
   * failure (Ruling [123]).
   *
   * It has its own status because the two failures need two vocabularies: telling a coordinator
   * "nothing was created" here sends them to start the sign-up again, and this patient gets a
   * second plan. The draft is deliberately KEPT in this state; it holds the plan id and both keys,
   * which is the only thing that makes the next press a retry rather than a duplicate.
   */
  | { status: "created-not-started"; planId: string; refusal: string }
  | { status: "created"; planId: string };

export function PlanWizard({
  referralId,
  patientId,
  teamId,
  actorId,
  actorRoleLabels,
  referralPathwayVersionId,
  pathwayOptions,
  sendingPreferenceOptions,
  fictionalPatientMobileNumbers,
  patientVisibleMessageSpecimen,
  intakePrefill = null,
}: PlanWizardProps) {
  // THE DRAFT IS NOT REACT STATE. It is `plan-draft.ts`'s store, subscribed to here — see that
  // module's note for why: a lazy `useState` initialiser that read `sessionStorage` would make the
  // server render and the client's first render disagree, and the disagreement would be about a
  // patient's details. `planDraftServerSnapshot` answers null through hydration, and the real draft
  // arrives in the commit after it.
  const stored = useSyncExternalStore(subscribeToPlanDraft, planDraftSnapshot, planDraftServerSnapshot);
  const storage = useSyncExternalStore(subscribeToPlanDraft, readStorageState, readServerStorageState);
  const [discarded, setDiscarded] = useState(false);
  const [submissionState, setSubmissionState] = useState<PlanSubmissionState>({ status: "idle" });
  /**
   * A decision refused at the moment it was CONFIRMED, held so the screen can say so in place.
   *
   * It has to live on the screen rather than in the overlay, and that is a real limit of the shared
   * host rather than a choice: `WorkspaceOverlays.recordDecision` calls the commit and then calls
   * `closeWorkspaceOverlay()` unconditionally, so an overlay cannot stay open to report a refusal
   * its own commit discovered. The matrix's "retain the surface" half is served by the OPEN-time
   * branch, where `{ kind: "unavailable", reason }` keeps the host's decision control focusable with
   * `aria-disabled` and the named reason beside it. This is the other half, and it is the one that
   * matters most: it appears only when nothing was changed, and it says so.
   */
  const [decisionRefusal, setDecisionRefusal] = useState<{ overlayId: string; reason: string } | null>(null);
  // `useRouter` is how a Client Component navigates in the App Router (Next 16). It is used ONCE,
  // after a plan has been confirmed created and after the draft has been cleared -- see `activate`.
  const router = useRouter();

  // A draft belonging to a DIFFERENT referral is removed rather than ignored, so one coordinator's
  // answers cannot sit in storage for the rest of the tab's life, referenced by nothing. This is a
  // side effect on an external system, which is what an effect is for; it sets no state, and the
  // store's own notification is what re-renders.
  useEffect(() => {
    readPlanDraft(referralId);
  }, [referralId]);

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const draft =
    stored !== null && stored.referralId === referralId
      ? stored
      : seedDraftFromIntake(emptyPlanDraft(referralId, referralPathwayVersionId), intakePrefill);

  // THE SECOND ENTRY OF THE MOBILE NUMBER IS HELD HERE, NOT IN THE DRAFT, AND THAT IS THE POINT.
  // The draft is restored after a refresh; a second entry restored with it would fill itself in and
  // stop being a second entry. So a refresh on stage 3 asks for the number again, and moving between
  // stages within the tab keeps it. Held at this level rather than in the stage so Back from review
  // does not throw it away. The shared-number check excludes this sign-up's own plan id once one has
  // been minted, so a retry after the plan was created does not find the patient's own plan.
  const mobileCheck = useMobileNumberCheck({
    mobile: draft.patientDetail.patientMobileNumber,
    mobileIsValid: mobileNumberProblem(draft.patientDetail.patientMobileNumber) === null,
    excludePlanId: draft.submission?.planId ?? null,
  });

  /**
   * Writes `change` applied to `base`, re-based onto whatever is ACTUALLY held if a conflicting
   * write landed first (#M6P1QQ). `base` is normally a closure-captured render value, which is
   * exactly what can go stale between two writes React flushes from the same commit -- see
   * `PlanDraft.version`'s own note for the shape of the race this catches.
   *
   * One retry, never a loop: `writePlanDraft` is synchronous start to finish and reads the live
   * draft itself before writing, so nothing else can interleave between the retry's read and its
   * write. A second conflict on the retry would mean a write happened DURING this synchronous call,
   * which cannot happen in this single-threaded flow.
   */
  function writeDraftWithRetry(base: PlanDraft, change: (current: PlanDraft) => PlanDraft): void {
    try {
      writePlanDraft(change(base), { expectedVersion: base.version });
    } catch (error) {
      if (!(error instanceof DraftConcurrencyError)) throw error;
      // Cast rather than re-derive: this module is the only thing that can have thrown from the
      // call above, and it always throws `DraftConcurrencyError<PlanDraft>` -- see writePlanDraft.
      const conflict = error as DraftConcurrencyError<PlanDraft>;
      const live =
        conflict.currentDraft ??
        seedDraftFromIntake(emptyPlanDraft(base.referralId, base.pathwayVersionId), intakePrefill);
      writePlanDraft(change(live), { expectedVersion: live.version });
    }
  }

  // Keep the unload guard for sending / refused / created-not-started: those
  // paths intentionally retain the draft, and dropping the beforeunload prompt
  // would silently discard patient details on reload (review on #2789).
  const isDirty =
    !discarded && submissionState.status !== "created" && isPlanDraftDirty(draft, referralId, referralPathwayVersionId);

  useDirtyStateGuard(isDirty);

  // RULING [120]: minted at the moment stage 4 is REACHED, not at the moment it is confirmed.
  //
  // Two ways to arrive, so two call sites for one function. `goTo("review")` covers the ordinary
  // path and mints in the same write that moves the stage, so the screen never renders once with no
  // identity. This effect covers the other: a stored draft that already names `review` -- a reload,
  // or a draft written before this build existed. Both go through `mintPlanSubmissionIdentity`, and
  // neither re-mints, because a fresh plan id on a retry is how one patient gets two plans.
  useEffect(() => {
    if (draft.stage !== "review") return;
    if (draft.submission !== null) return;
    // Minted ONCE per effect run, outside the retry closure -- a retry must re-apply this SAME
    // identity onto whatever is actually held, never mint a second one, or a re-based write could
    // hand one patient two plan identities from one effect firing.
    const submission = mintPlanSubmissionIdentity();
    writeDraftWithRetry(draft, (current) => ({ ...current, submission }));
    // writeDraftWithRetry is recreated each render; listing it would re-fire this mint effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mint once per draft identity, not per helper identity
  }, [draft]);

  /** Every change goes through here, so nothing can update the screen without updating the draft. */
  function update(change: (current: PlanDraft) => PlanDraft) {
    setDiscarded(false);
    writeDraftWithRetry(draft, change);
  }

  function discard() {
    clearPlanDraft();
    setDiscarded(true);
  }

  /**
   * What the decision guards are answered from AT RENDER.
   *
   * Built from the two subscribed snapshots rather than by calling the store again, so the value a
   * trigger is rendered against is the same value this render was produced from. The commit reads
   * its own, later.
   */
  const decisionStateNow: WizardDecisionState = {
    draftExists: stored !== null && stored.referralId === referralId,
    draftIsWrittenDown: storage === "held",
  };

  /**
   * One of the wizard's decisions, guarded at both moments.
   *
   * OPEN TIME decides the commit's KIND. A condition already unmet gives
   * `{ kind: "unavailable", reason }`, which `commitRefusalFor` scopes `every-row`, so the host
   * renders the reason and keeps its decision control focusable with `aria-disabled` — the frozen
   * matrix's guard-rejection shape, implemented by the host rather than re-derived here.
   *
   * COMMIT TIME decides whether the decision happens. The conditions are asked again from
   * `liveDecisionState()`, which reads the draft store at that instant. This is the check the naive
   * version passes without: a coordinator can open a confirmation and press it much later, and by
   * then the tab may hold a different draft or none.
   */
  function decisionCommit(overlayId: string, perform: () => void): WorkspaceOverlayCommit {
    // The same value twice, because at this moment nothing has changed yet. That is the honest
    // answer rather than a placeholder: `sign-up-still-here` is a comparison and has nothing to
    // compare against until the decision is confirmed.
    const refusedNow = wizardDecisionRefusal(overlayId, decisionStateNow, decisionStateNow);
    if (refusedNow !== null) return { kind: "unavailable", reason: refusedNow };
    return {
      kind: "record",
      record: () => {
        // `decisionStateNow` is what was true when this control was ACTIVATED -- the commit was
        // staged from that render -- and `liveDecisionState()` reads the store now.
        const refusedAtCommit = wizardDecisionRefusal(overlayId, decisionStateNow, liveDecisionState());
        if (refusedAtCommit !== null) {
          // NOTHING IS MUTATED ON THIS PATH, and that is the clause the frozen contract states and
          // that a test is easiest to write without: `perform` is simply not called.
          setDecisionRefusal({ overlayId, reason: refusedAtCommit });
          return;
        }
        setDecisionRefusal(null);
        perform();
      },
    };
  }

  /** The same two facts, read at the moment they are asked rather than at the moment of render. */
  function liveDecisionState(): WizardDecisionState {
    const held = planDraftSnapshot();
    return {
      draftExists: held !== null && held.referralId === referralId,
      draftIsWrittenDown: planDraftIsHeld(),
    };
  }

  /**
   * Records a decision onto the draft the tab holds NOW, never onto the one this render closed over.
   *
   * This is the mechanism the commit-time recheck exists to make honest, not a second copy of it.
   * The guard decides WHETHER to write at all; this decides what is written on top of, and reading
   * the captured `draft` here would reinstate exactly the staleness the guard was added to prevent.
   *
   * THE FALLBACK IS THE SAME EXPRESSION THE RENDER USES, and deliberately so: a screen nobody has
   * typed into yet holds no stored draft, so a decision confirmed there writes the first one, which
   * is what the ordinary controls already do on their first keystroke. Doing nothing instead would
   * make this the silent no-op Ruling 87 exists to prevent -- a control that opens a decision
   * surface, is confirmed, and records nothing. The case the guard refuses is different and is
   * already refused before this runs: a draft that WAS there and has since been removed.
   */
  function recordOnLiveDraft(change: (current: PlanDraft) => PlanDraft) {
    const held = planDraftSnapshot();
    const base =
      held !== null && held.referralId === referralId
        ? held
        : seedDraftFromIntake(emptyPlanDraft(referralId, referralPathwayVersionId), intakePrefill);
    setDiscarded(false);
    writeDraftWithRetry(base, change);
  }

  /**
   * The seven decisions this screen offers, built once per render so a stage renders a value rather
   * than reaching back into this closure.
   *
   * `pathway-preview` is missing from here deliberately: its decision is "Use this pathway", which
   * names a version, so its commit is minted per option row by the factory below.
   */
  const decisionCommits = {
    verifyIdentity: decisionCommit("verify-identity", () =>
      recordOnLiveDraft((current) => ({ ...current, decisions: { ...current.decisions, identityChecked: true } })),
    ),
    changePatient: decisionCommit("change-patient", () => {
      // Ordered as Ruling [117] orders the activation pair, and for the same reason pointed the
      // other way: the draft holds a patient's name and mobile number, so it is removed BEFORE the
      // screen that held it goes away. Navigating first would leave it in this tab's storage with
      // nothing on screen to point at the control that removes it.
      clearPlanDraft();
      setDiscarded(true);
      router.push(CARING_CONTACTS_ROUTES.patients);
    }),
    communicationPreference: decisionCommit("communication-preference", () =>
      recordOnLiveDraft((current) => ({
        ...current,
        decisions: { ...current.decisions, preferenceGivenOnStaffedLine: true },
      })),
    ),
    saveDraft: decisionCommit("save-draft", () => {
      // THE DRAFT IS DELIBERATELY NOT WRITTEN AGAIN HERE, and the reason is narrow: every change
      // already goes through `update`, so this sign-up is on this computer as it stands and an
      // identical write would be a gesture rather than an action.
      //
      // WHAT CONFIRMING DOES IS LEAVE, AND THE SCREEN SAYS SO BEFORE IT IS PRESSED -- see
      // `SAVE_DRAFT_DESTINATION` and the control's own accessible name. The frozen drawer cannot:
      // its title, decision and summary are the approved design and none of them mentions leaving,
      // and `OverlayHost` renders that copy and takes no children. The matrix's Navigation clause
      // is a contract this SCREEN owes, so the screen discharges it in the two places a coordinator
      // reads before confirming, rather than the frozen copy being amended to fit an
      // implementation detail. An unannounced navigation was the defect; announcing it is additive
      // and reversible, where editing the drawer would be neither.
      router.push(CARING_CONTACTS_ROUTES.patients);
    }),
    discardChanges: decisionCommit("discard-changes", discard),
  };

  /** `pathway-preview`'s commit for one option row. Confirming it is what chooses that version. */
  function pathwayPreviewCommit(optionId: string): WorkspaceOverlayCommit {
    return decisionCommit("pathway-preview", () =>
      recordOnLiveDraft((current) => ({ ...current, pathwayVersionId: optionId })),
    );
  }

  const stage = draft.stage;
  const implementation = planWizardStageImplementation(stage);
  const body = stageBody();

  // The draft is gone the moment a plan is created, so the wizard would otherwise re-render as a
  // fresh sign-up at stage 1 while the navigation is still in flight. This states what happened
  // instead. It is not a substitute for navigating -- the push has already been called.
  if (submissionState.status === "created") {
    return (
      <div className="flex min-w-0 flex-col gap-5" data-testid="caring-contacts-plan-wizard">
        <section aria-label="Plan created" className={panelClass}>
          <h2 className={headingClass}>The plan was created and started</h2>
          <p className={`mt-1 ${mutedTextClass}`}>
            The plan, the patient&rsquo;s details and the twelve-month schedule were created and recorded, and the plan
            was then started, so the schedule is running. Nothing was sent to any number, and nothing from this sign-up
            is left on this computer.
          </p>
          <p className={`mt-2 ${mutedTextClass}`}>Taking you to the plan on the patient&rsquo;s own screen.</p>
        </section>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="caring-contacts-plan-wizard">
      <Stepper active={stage} />
      <DraftNotice
        storage={storage}
        discarded={discarded}
        discardCommit={decisionCommits.discardChanges}
        saveCommit={decisionCommits.saveDraft}
      />
      {/*
        A decision refused at the moment it was confirmed, stated where the clinician is looking.

        `role="status"` rather than `role="alert"`: the person pressed a control and is waiting for
        an answer, so a polite announcement reaches them without interrupting anything, and the
        refusal is also visible text rather than an announcement alone.
      */}
      {decisionRefusal === null ? null : (
        <div role="status" data-testid="caring-contacts-decision-refusal">
          <StatedReason
            heading={`${decisionRefusalHeading(decisionRefusal.overlayId)} — nothing was changed`}
            because={decisionRefusal.reason}
            changedBy="Nothing on this screen. The decision was not carried out, so there is nothing here to undo."
            icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
          />
        </div>
      )}
      {implementation.kind === "not-built" ? (
        <UnbuiltStagePanel stage={stage} reason={implementation.reason} onBack={goBack} />
      ) : (
        assertBuiltStageHasABody(body, stage)
      )}
    </div>
  );

  function goTo(next: PlanWizardStage) {
    update((current) => ({
      ...current,
      stage: next,
      // Minted in the same write that moves the stage -- see the effect above for why there are two
      // call sites and why neither re-mints.
      submission: next === "review" && current.submission === null ? mintPlanSubmissionIdentity() : current.submission,
    }));
  }

  /**
   * The two writes this screen performs, and the orderings Rulings [117] and [123] are about.
   *
   *   1. CONFIRM SUCCESS, then clear the draft, then navigate -- and success means BOTH writes
   *      (Ruling [123]). Clearing before the answer loses a clinician's typing on a failure;
   *      navigating before clearing leaves a patient's name and mobile number in this tab's storage
   *      on a shared ward computer with the screen already gone.
   *   2. ON ANY FAILURE THE DRAFT SURVIVES -- a lost connection, a refusal, an unreadable answer,
   *      AND the half-done case where the plan exists but did not start. That last one is where
   *      "clear on success" needed refining rather than repeating: the draft holds the plan id and
   *      both keys, and that is exactly what distinguishes "try again" from "create a second plan
   *      for this patient". Nothing below touches the draft on any path but the fully successful
   *      one.
   *   3. THE REFUSAL SAYS WHICH FAILURE IT WAS, in words, in place. `writeHandler`'s codes
   *      distinguish "you may not", "this already exists" and "the schedule could not be built", and
   *      `submissionRefusalWording` is total over every one of them.
   *
   * It never rejects. The overlay host re-throws a rejected commit during render, which would land
   * on `error.tsx` -- a whole-screen error for something this function can state in place, with the
   * draft still in hand.
   */
  async function activate() {
    const submission = draft.submission;
    const body = createPlanRequestBody({
      submission,
      referralId,
      patientId,
      pathwayVersionId: draft.pathwayVersionId,
      activation: draft.activation,
      sendingPreference: draft.sendingPreference,
      patientDetail: createPlanPatientDetail(draft.patientDetail),
      assurances: draft.assurances,
    });
    // Unreachable through the interface: the trigger's commit is `unavailable` whenever the body
    // cannot be built, so the overlay refuses in place rather than opening a control that would land
    // here. Guarded rather than asserted, because a caller is one edit away. `submission` is
    // re-checked for the type system's benefit -- `createPlanRequestBody` already refused a null one.
    if (body === null || submission === null) return;

    setSubmissionState({ status: "sending" });

    const created = await post(CREATE_PLAN_ENDPOINT, body);
    if (!created.ok) {
      // Nothing exists. This is the only path that may say so.
      if (isMountedRef.current) setSubmissionState({ status: "refused", refusal: created.refusal });
      return;
    }

    // FROM HERE ON THE PLAN EXISTS, and no path below may report otherwise.
    const notStarted = (refusal: string) => {
      if (isMountedRef.current) {
        setSubmissionState({ status: "created-not-started", planId: body.planId, refusal });
      }
    };

    const expectedVersion = planVersionFromCreateAnswer(created.payload);
    if (expectedVersion === null) {
      // The second write is NOT attempted with a guessed version. A guess would earn a refusal
      // about concurrency instead of about the answer this screen could not read, and the plan is
      // recoverable either way.
      notStarted(TRANSPORT_REFUSALS.unreadableAnswer);
      return;
    }

    const started = await post(
      startPlanEndpoint(body.planId),
      activatePlanRequestBody({ submission, expectedVersion }),
    );
    if (!started.ok) {
      notStarted(started.refusal);
      return;
    }

    // Both writes are confirmed. Only now, and in this order.
    clearPlanDraft();
    if (isMountedRef.current) {
      setSubmissionState({ status: "created", planId: body.planId });
      router.push(patientPlanRoute(patientId, body.planId));
    }
  }

  /**
   * One write, and every way it can fail turned into a named refusal rather than a thrown error.
   *
   * Shared by both writes because the transport failures are identical for each -- what DIFFERS is
   * what a failure means, and that is decided by the caller, which knows whether a plan exists yet.
   * Folding that decision in here is how "nothing was created" would end up printed over a plan
   * that had just been created.
   */
  async function post(
    url: string,
    requestBody: unknown,
  ): Promise<{ ok: true; payload: unknown } | { ok: false; refusal: string }> {
    let answer: Response;
    try {
      answer = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
    } catch {
      return { ok: false, refusal: TRANSPORT_REFUSALS.didNotReach };
    }

    let payload: unknown;
    try {
      payload = await answer.json();
    } catch {
      // The write MAY have landed -- an unreadable answer says nothing about what the service did.
      // The caller keeps the draft either way, and retrying is harmless because the identifiers are
      // reused.
      return { ok: false, refusal: TRANSPORT_REFUSALS.unreadableAnswer };
    }

    if (!answer.ok) return { ok: false, refusal: refusalNameFrom(payload) };
    return { ok: true, payload };
  }

  function goBack() {
    const previous = previousPlanWizardStage(stage);
    if (previous !== null) goTo(previous);
  }

  /**
   * The body for the current stage, or null where this task built none.
   *
   * The `never` default is what makes the stage set exhaustive: a stage added to the union and
   * left out of this switch does not compile. `assertBuiltStageHasABody` closes the other half —
   * a stage whose table entry says "built" while this switch still returns null.
   */
  function stageBody(): ReactNode | null {
    switch (stage) {
      case "agreement":
        return (
          <>
            {intakePrefill ? <IntakeClinicalBanner intake={intakePrefill} /> : null}
            <AgreementStage
              referralId={referralId}
              patientId={patientId}
              teamId={teamId}
              actorId={actorId}
              actorRoleLabels={actorRoleLabels}
              assurances={draft.assurances}
              identityChecked={draft.decisions.identityChecked}
              verifyIdentityCommit={decisionCommits.verifyIdentity}
              changePatientCommit={decisionCommits.changePatient}
              intake={intakePrefill ?? null}
              onAssuranceChange={(change) =>
                update((current) => ({ ...current, assurances: { ...current.assurances, ...change } }))
              }
              onContinue={() => goTo("pathway")}
            />
          </>
        );
      case "pathway":
        return (
          <PathwayStage
            options={pathwayOptions}
            chosen={draft.pathwayVersionId}
            referralPathwayVersionId={referralPathwayVersionId}
            pathwayPreviewCommit={pathwayPreviewCommit}
            onChoose={(id) => update((current) => ({ ...current, pathwayVersionId: id }))}
            onBack={goBack}
            onContinue={() => goTo("personalisation")}
          />
        );
      case "personalisation":
        return (
          <PersonalisationStage
            detail={draft.patientDetail}
            intake={intakePrefill ?? null}
            sendingPreference={draft.sendingPreference}
            sendingPreferenceOptions={sendingPreferenceOptions}
            fictionalPatientMobileNumbers={fictionalPatientMobileNumbers}
            patientVisibleMessageSpecimen={patientVisibleMessageSpecimen}
            preferenceGivenOnStaffedLine={draft.decisions.preferenceGivenOnStaffedLine}
            communicationPreferenceCommit={decisionCommits.communicationPreference}
            mobileCheck={mobileCheck}
            onDetailChange={(change) =>
              update((current) => ({ ...current, patientDetail: { ...current.patientDetail, ...change } }))
            }
            onSendingPreferenceChange={(preference) =>
              update((current) => ({ ...current, sendingPreference: preference }))
            }
            onBack={goBack}
            onContinue={() => goTo("review")}
          />
        );
      case "review":
        return (
          <ReviewStage
            referralId={referralId}
            patientId={patientId}
            teamId={teamId}
            actorId={actorId}
            actorRoleLabels={actorRoleLabels}
            assurances={draft.assurances}
            detail={draft.patientDetail}
            intake={intakePrefill ?? null}
            pathwayVersionId={draft.pathwayVersionId}
            sendingPreference={draft.sendingPreference}
            sendingPreferenceOptions={sendingPreferenceOptions}
            activation={draft.activation}
            submission={draft.submission}
            state={submissionState}
            onActivationChange={(change) =>
              update((current) => ({ ...current, activation: { ...current.activation, ...change } }))
            }
            onActivate={activate}
            onBack={goBack}
          />
        );
      default: {
        const unrendered: never = stage;
        return unrendered;
      }
    }
  }
}

/**
 * Fails loudly when a stage claims to be built and has no body.
 *
 * The `never` default in `stageBody` catches a stage nobody handled. It cannot catch the opposite
 * mistake, which is the one Tasks 8 and 9 could each have made: flipping an entry in
 * `planWizardStageImplementation` to `built` and not writing the body. That would render a stepper,
 * a notice, and an empty column where a clinician expects a patient's details — so it throws, and
 * `error.tsx` says nothing was sent and nothing was changed, both of which are true.
 *
 * EXPORTED SO IT CAN BE PROVED, and that is Task 9's finding rather than a preference. `stages.ts`
 * said from Task 7 onward that the wizard's DOM suite proves this fires; nothing did. It was a
 * mechanism nobody had run, written down as coverage, in the one guard protecting the mistake each
 * later task could actually make. Now that every stage is built, no render can reach it at all — so
 * the only honest proof is to call it, which `tests/caring-contacts-plan-wizard.dom.test.tsx` does.
 */
export function assertBuiltStageHasABody(body: ReactNode | null, stage: PlanWizardStage): ReactNode {
  if (body === null) {
    throw new Error(
      `caring-contacts plan wizard: stage "${stage}" is marked built but this component renders no body for it.`,
    );
  }
  return body;
}

/**
 * Whether this browser is actually keeping the draft.
 *
 * Read through the same store subscription as the draft itself, for the same hydration reason: the
 * server cannot know, so it answers `"pending"` and the truth arrives on the client. The notice's
 * wording follows this rather than stating an intention — a notice promising the page will remember
 * is false when the browser refused.
 */
function readStorageState(): "held" | "refused" {
  return planDraftIsHeld() ? "held" : "refused";
}

function readServerStorageState(): "pending" {
  return "pending";
}

/**
 * What is being kept on this computer, said in plain words and in place (Ruling [110]).
 *
 * This is the system doing something the clinician did not ask for, which is exactly the contract
 * spec §4.4 sets: the surface stating the state also states why, and what would change it. A
 * notice reachable only by hovering has not been stated, so this is text in the flow of the page,
 * and the control that acts on it is beside the words that describe it.
 *
 * The wording follows what actually happened rather than what was intended. `"pending"` is the
 * server render and the first client render, before this browser has been asked; `"refused"` is a
 * browser that would not keep anything, where a notice promising the page will remember would be
 * false.
 */
/**
 * What the draft notice says, per storage answer.
 *
 * A `Record` rather than nested ternaries: the three answers are three different facts, and the
 * ternary version is how `"pending"` came to borrow `"held"`'s wording and claim something untrue.
 */
/*
 * ROUND 1, ITEM 5: THE NOTICE NAMES WHAT IT HOLDS.
 *
 * This wording was written for a draft that held two checkboxes, and said "what you enter here" —
 * accurate, and no use at all for judging the risk once stage 3 puts a patient's NAME and MOBILE
 * NUMBER into that storage on what is in practice a shared ward computer. A clinician reading the
 * old sentence had no way to know which of those two drafts they were being told about.
 *
 * Ruling [110] is about this sentence. Naming the destination is necessary and was already done —
 * "written to this computer's storage for this tab only" — but naming the destination without
 * naming the CONTENT leaves the reader unable to weigh the "Discard draft" decision the same
 * sentence points them at. Both halves now appear.
 *
 * "Name the destination, not the act" still holds; this adds to it rather than replacing it.
 */
const DRAFT_NOTICE_WORDING: Record<
  "pending" | "held" | "refused",
  { heading: string; because: string; changedBy: string }
> = {
  pending: {
    heading: "Nothing is being kept on this computer yet",
    because:
      "This screen has not finished starting up, so nothing you enter has been written down. If JavaScript is turned off it never will be, and the controls below will not work either.",
    changedBy:
      "Once the screen is ready, what you enter — including the patient's name and mobile number — is kept on this computer for this tab only, and Discard draft removes it at once.",
  },
  held: {
    heading: "Kept on this computer until you close the tab",
    because:
      "So that reloading the page does not lose a part-finished sign-up, what you enter here — including the patient's name and mobile number — is written to this computer's storage for this tab only. It is not sent anywhere, and nothing is sent to any number from this screen.",
    changedBy:
      "Closing this tab removes it. Discard draft, below, removes it now — use it if you are stepping away from a shared computer.",
  },
  refused: {
    heading: "Nothing is being kept on this computer",
    because: "This browser would not let the page keep anything, so nothing you enter here is written down.",
    changedBy:
      "Nothing. Reloading or closing the tab loses what you have entered, so finish this sign-up in one sitting.",
  },
};

function DraftNotice({
  storage,
  discarded,
  discardCommit,
  saveCommit,
}: {
  storage: "pending" | "held" | "refused";
  discarded: boolean;
  /**
   * What confirming `discard-changes` does. The control below RAISES that confirmation; it no
   * longer discards on its own press.
   *
   * The frozen matrix puts `discard-changes` on this screen precisely because the act is
   * irreversible and unannounced: the old control removed a patient's name and mobile number, and
   * everything else typed, on one click with nothing in between. Its own summary — "Only the edits
   * made in this session go" — is the sentence a coordinator most needs before pressing it.
   */
  discardCommit: WorkspaceOverlayCommit;
  /**
   * What confirming `save-draft` does: leave this screen with the sign-up still on this computer.
   *
   * The pair is deliberate. `discard-changes` and `save-draft` are the two ways to walk away from a
   * half-finished sign-up, they differ in exactly one thing — whether a patient's details are left
   * on this machine — and offering only the destructive one is how a coordinator ends up with no
   * way to step out that does not throw their work away.
   *
   * NOTHING IS WRITTEN AGAIN BY CONFIRMING IT. Every keystroke already goes through the draft, so
   * the sign-up is on this computer as it stands; the decision is to LEAVE it that way, which is
   * why its guard asks whether this browser will still be holding it once this page is gone.
   */
  saveCommit: WorkspaceOverlayCommit;
}) {
  // Three wordings, not two — round 1, finding M-3. `"pending"` used to borrow the affirmative
  // wording, which made the server-rendered page claim that what a clinician types "is written to
  // this computer's storage" before this browser had been asked anything. With JavaScript turned
  // off that claim is not merely early, it is permanent AND false: nothing is stored, and none of
  // the controls below work either. So `"pending"` gets its own wording, and the `<noscript>` line
  // states the JavaScript case where the wording alone would still be read as a temporary state.
  const words = DRAFT_NOTICE_WORDING[storage];

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <noscript>
        <p className="max-w-[var(--measure)] text-sm leading-6 text-[color:var(--text-muted)]">
          This screen needs JavaScript, and it is the only one in this workspace that does. With it turned off nothing
          you type here is kept and none of the controls below do anything, so a plan cannot be started from this page.
        </p>
      </noscript>
      <StatedReason
        heading={words.heading}
        because={words.because}
        changedBy={words.changedBy}
        icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
      />
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <WorkspaceOverlayTrigger overlayId="discard-changes" commit={discardCommit} className={secondaryControlClass}>
          <Trash2 aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="truncate">Discard draft</span>
        </WorkspaceOverlayTrigger>
        <WorkspaceOverlayTrigger overlayId="save-draft" commit={saveCommit} className={secondaryControlClass}>
          <FileCheck2 aria-hidden="true" className="size-icon-md shrink-0" />
          <span className="truncate">Leave this for now</span>
          {/*
            The destination in the control's own accessible name. "Leave this for now" says a
            coordinator is going somewhere and not where, and the confirmation they open next cannot
            tell them either -- the frozen drawer's copy does not mention leaving at all.
          */}
          <span className="sr-only"> &mdash; {SAVE_DRAFT_DESTINATION}</span>
        </WorkspaceOverlayTrigger>
        {/*
          WHICH OF THE TWO THIS DISCARDS, said without leaving it to be inferred. This system
          distinguishes "held in this tab's storage" from "written onto the plan" while ordinary
          English does not, and "discard" alone reads as either. Nothing has been written onto a
          plan at this point — the plan does not exist yet — so there is nothing on any record to
          lose, and saying so is what stops a coordinator hesitating over a control they should use
          when they step away from a shared computer.
        */}
        <p className={mutedTextClass}>
          Discarding removes this sign-up from this computer. It changes no plan and no record: nothing has been written
          onto a plan yet, because the plan is created at the last stage.
        </p>
        {/*
          THE PAIR, AND WHERE EACH ONE LEAVES YOU. The two controls above differ in one thing a
          coordinator cares about and one they cannot see: whether a patient's details stay on this
          machine, and whether the screen changes. The second is the matrix's Navigation clause --
          "announce the destination" -- and it is stated here because the confirmation that opens
          next carries the approved drawer copy, which does not mention leaving.
        */}
        <p className={mutedTextClass} data-testid="caring-contacts-draft-exit-destinations">
          Leave this for now {SAVE_DRAFT_DESTINATION}. Discard draft removes it and stays on this screen.
        </p>
        <p role="status" className="min-w-0 text-sm text-[color:var(--text-muted)]">
          {discarded ? "The draft was discarded. Nothing from it is left on this computer." : ""}
        </p>
      </div>
    </div>
  );
}

/**
 * Stage 1 — what this team is working from, and what the coordinator confirms.
 *
 * RULING [112], AND IT IS THE WHOLE SHAPE OF THIS STAGE. The approved mockup renders an identity
 * row (`patient.fullName · patient.id`) and a mobile-suitability row, both sourced "Imported
 * referral record". Neither is reproducible: `Referral` in `src/lib/caring-contacts/model.ts` is
 * exactly `id`, `teamId`, `patientId`, `state` and `pathwayVersionId`, and there is no patient name
 * and no mobile number on a referral anywhere in this domain. Those arrive in
 * `createPlanSchema.patientDetail`, typed by the clinician at stage 3.
 *
 * So this screen separates the two things the mockup blended, and labels each with where it came
 * from. An interface that presents a clinician's own tick as an imported record is lying about
 * provenance, on a screen whose entire purpose is assurance.
 *
 * WHAT THE PLAN RECORDS ABOUT THESE CONFIRMATIONS, AND WHAT IT DOES NOT. Until Task 9b there was no
 * field for either of them anywhere, so they lived only in the draft and were dropped when the
 * sign-up finished. The owner closed that: creating the plan now records an ATTESTATION for each
 * one — that this coordinator confirmed this check, and when.
 *
 * It records the CONFIRMATION, not the thing confirmed. The plan can say a coordinator confirmed the
 * patient's agreement before it was created; it cannot say the patient consented, because this
 * system is not where consent is held — the hospital record is, and the coordinator is confirming
 * they checked it. No sentence on this screen may blur those two, in either direction.
 *
 * Before the plan is created the ticks are still only in the draft, and the draft is not durable, so
 * the status line below points at the control that removes them.
 */
function AgreementStage({
  referralId,
  patientId,
  teamId,
  actorId,
  actorRoleLabels,
  assurances,
  identityChecked,
  verifyIdentityCommit,
  changePatientCommit,
  intake,
  onAssuranceChange,
  onContinue,
}: {
  referralId: string;
  patientId: string;
  teamId: string;
  actorId: string;
  actorRoleLabels: readonly string[];
  assurances: { patientAgreed: boolean; mobileIsPatientControlled: boolean };
  /** Whether `verify-identity` has been confirmed for this sign-up. Held in the draft, on no plan. */
  identityChecked: boolean;
  verifyIdentityCommit: WorkspaceOverlayCommit;
  changePatientCommit: WorkspaceOverlayCommit;
  /** The intake payload stored with this referral, or null when it was created without one. */
  intake: ReferralIntakePayload | null;
  onAssuranceChange: (change: Partial<{ patientAgreed: boolean; mobileIsPatientControlled: boolean }>) => void;
  onContinue: () => void;
}) {
  // The same predicate stage 4 uses before it will build a create body, so the gate a coordinator
  // passes here and the gate the request passes there cannot come apart.
  const complete = everyAssuranceConfirmed(assurances);
  return (
    <section aria-label="Agreement" className="flex min-w-0 flex-col gap-5">
      <div className={panelClass}>
        <h2 className={headingClass}>Read from the referral</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          Everything in this list was read from the referral record or from the session you are acting in. Nothing in it
          was typed on this screen.
        </p>
        <div className="mt-3 min-w-0">
          <SourcedFact
            icon={<IdCard aria-hidden="true" className="size-icon-md" />}
            label="Referral"
            value={referralId}
            source="Read from the referral record"
          />
          <SourcedFact
            icon={<IdCard aria-hidden="true" className="size-icon-md" />}
            label="Patient identifier"
            value={patientId}
            source={
              intake
                ? "Read from the referral record. The name and mobile number recorded at intake are carried into personalisation, where you check them."
                : "Read from the referral record. This referral was saved without a name or mobile number; those are entered at personalisation."
            }
          />
          <SourcedFact
            icon={<ShieldCheck aria-hidden="true" className="size-icon-md" />}
            label="Owning team"
            value={teamId}
            source="Read from the referral record, which this team accepted"
          />
          <SourcedFact
            icon={<UserRoundCheck aria-hidden="true" className="size-icon-md" />}
            label="Acting as"
            value={`${actorId} — ${actorRoleLabels.join(", ")}`}
            source="Read from the session you are signed in with, not from the referral"
          />
        </div>

        {/*
          THE TWO DECISIONS THE FROZEN MATRIX PUTS ON THIS GATE, beside the facts they are about.

          `verify-identity` is a confirmation, not a check the system can make: this workspace holds
          no source record to compare against, so what is confirmed is that a PERSON compared them.
          The line below says where that confirmation goes, in the terms this system distinguishes —
          onto this computer, for this tab, and onto no plan — because "recorded" alone reads as the
          patient's record and this one is not that.

          `change-patient` is the destructive twin and is offered here rather than buried, because
          the moment a coordinator realises they are signing up the wrong person is the moment they
          are reading this panel. Its own summary states the cost before it is paid.
        */}
        <div className="mt-4 flex min-w-0 flex-col gap-3">
          <p role="status" className={mutedTextClass} data-testid="caring-contacts-identity-check-state">
            {identityChecked
              ? "You have confirmed that this is the right person. That confirmation is kept on this computer for this tab, with the rest of this sign-up, and is written onto no plan — this system has no field for it."
              : "Nobody has confirmed yet that this is the right person. This system holds no record to compare against, so the comparison is one a person makes."}
          </p>
          <div className="flex min-w-0 flex-wrap gap-3">
            <WorkspaceOverlayTrigger
              overlayId="verify-identity"
              commit={verifyIdentityCommit}
              facts={identityFacts({ patientId, intake })}
              className={secondaryControlClass}
            >
              <IdCard aria-hidden="true" className="size-icon-md shrink-0" />
              <span className="truncate">{identityChecked ? "Check the identity again" : "Check the identity"}</span>
            </WorkspaceOverlayTrigger>
            <WorkspaceOverlayTrigger
              overlayId="change-patient"
              commit={changePatientCommit}
              className={secondaryControlClass}
            >
              <UserRoundCheck aria-hidden="true" className="size-icon-md shrink-0" />
              <span className="truncate">This is not the right patient</span>
            </WorkspaceOverlayTrigger>
          </div>
        </div>
      </div>

      <div className={panelClass}>
        <h2 className={headingClass}>Confirmed by you</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          These are your own confirmations, not imported facts, and the difference matters. What the plan records is
          that you confirmed each of these, and when &mdash; not that the patient consented. Agreement is held in the
          patient&rsquo;s hospital record; what you are confirming here is that you checked it.
        </p>
        <fieldset className="mt-3 min-w-0 border-0 p-0">
          <legend className="sr-only">Assurances you are confirming</legend>
          <label className="flex min-h-tap min-w-0 items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={assurances.patientAgreed}
              onChange={(event) => onAssuranceChange({ patientAgreed: event.target.checked })}
              className="mt-1 size-5 shrink-0 accent-[color:var(--clinical-accent)]"
            />
            <span className={mutedTextClass}>
              The patient agreed to receive caring contacts. This is not consent to treatment and not a legal consent.
            </span>
          </label>
          <label className="flex min-h-tap min-w-0 items-start gap-3 py-2">
            <input
              type="checkbox"
              checked={assurances.mobileIsPatientControlled}
              onChange={(event) => onAssuranceChange({ mobileIsPatientControlled: event.target.checked })}
              className="mt-1 size-5 shrink-0 accent-[color:var(--clinical-accent)]"
            />
            <span className={mutedTextClass}>
              The mobile number this plan will use is the patient&rsquo;s own, and they are content to receive discreet
              text messages on it.
            </span>
          </label>
        </fieldset>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        {/*
          THIS SENTENCE HAS BEEN WRONG IN BOTH DIRECTIONS, AND THE SECOND WAS WORSE.

          Round 1, M-6: it read "Both confirmations are recorded for this sign-up", directly beneath
          a panel saying nothing in this domain records them. That OVERSTATED durability, and the gap
          is with the owner as a schema decision — a screen implying it is already handled is the one
          thing that could make that decision look unnecessary.

          Round 2, item 1: the replacement read "Neither is stored anywhere", which UNDERSTATED it and
          was simply untrue — every tick goes through `writePlanDraft` into this tab's storage, and
          the draft notice on this same screen says so in as many words. That direction is the more
          dangerous of the two: a clinician on a shared ward computer who reads "neither is stored
          anywhere" has just been given a reason NOT to press Discard draft, while the patient's name
          and mobile number sit in that tab's storage. It works against the third requirement of
          Ruling [110].

          What was true then was the qualifier the panel above never dropped: neither confirmation was
          recorded ON THE PLAN. TASK 9B MADE THAT FALSE ON PURPOSE — creating the plan now records an
          attestation for each confirmation. So the sentence states what the plan will record, and
          still points at the control that removes the draft, because until the plan exists the ticks
          are held on this computer exactly as round 2 found.

          The third direction this sentence could go wrong, now that there IS a record: claiming the
          plan records the patient's agreement. It records that YOU confirmed it. That is the whole
          distinction the panel above draws, and it must survive here too.
        */}
        <p role="status" className={mutedTextClass}>
          {complete
            ? "Both confirmations are ticked, so a pathway can be chosen. Each is recorded on the plan when the plan is created — that you confirmed it, and when. Until then, like everything else on this screen, they are kept on this computer until you finish or discard."
            : "A pathway cannot be chosen until both confirmations above are ticked."}
        </p>
        <div className="flex min-w-0 flex-wrap gap-3">
          <button type="button" disabled={!complete} onClick={onContinue} className={primaryControlClass}>
            <ClipboardCheck aria-hidden="true" className="size-icon-md shrink-0" />
            <span className="truncate">Continue to pathway</span>
          </button>
        </div>
      </div>
    </section>
  );
}

/**
 * Stage 2 — which governed pathway version this plan runs.
 *
 * RULING [113]. `transitionReferral`'s `accept` action carries a `pathwayVersionId` and
 * `Referral.pathwayVersionId` holds it, so an accepted referral can already name a pathway, chosen
 * by whoever accepted it. This stage shows that as the existing decision and says where it came
 * from, rather than presenting an empty choice as though nothing had been decided — and choosing
 * something else reads as changing an earlier decision, because that is what it is. Spec §4.4
 * again: where something has already been decided, the surface stating it also states why and what
 * would change it.
 *
 * If the referral names none, this is an ordinary first choice and says nothing about a decision
 * that was never made.
 *
 * NO MESSAGE TEXT IS RENDERED HERE. Patient-visible copy is frozen and belongs to the sealed
 * domain's `message-copy`; the cadence wording below comes from the version's own frozen snapshot,
 * so nothing on this screen is a literal a screen author chose. The one place the governed wording
 * itself appears is stage 3, where it is READ from that module and rendered as it arrives.
 *
 * `pathway-preview` IS WIRED PER OPTION ROW, and it is the row whose Mutation column surprises
 * people: the frozen matrix marks it Yes and its decision is "Use this pathway", so confirming it
 * chooses that version. It is a selection surface with a preview in front of it, not an inspection
 * one.
 */
function PathwayStage({
  options,
  chosen,
  referralPathwayVersionId,
  pathwayPreviewCommit,
  onChoose,
  onBack,
  onContinue,
}: {
  options: readonly PlanWizardPathwayOption[];
  chosen: string | null;
  referralPathwayVersionId: string | null;
  /**
   * `pathway-preview`'s commit for one version. Per row rather than one for the stage, because its
   * frozen decision is "Use this pathway" and a single commit could not name which.
   */
  pathwayPreviewCommit: (optionId: string) => WorkspaceOverlayCommit;
  onChoose: (id: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const namedIsChoosable =
    referralPathwayVersionId !== null && options.some((option) => option.id === referralPathwayVersionId);
  const changedFromReferral =
    referralPathwayVersionId !== null && chosen !== null && chosen !== referralPathwayVersionId;

  return (
    <section aria-label="Pathway" className="flex min-w-0 flex-col gap-5">
      {referralPathwayVersionId === null ? null : namedIsChoosable ? (
        <StatedReason
          heading={
            changedFromReferral
              ? "You are changing an earlier decision"
              : "Already decided when the referral was accepted"
          }
          because={`Accepting this referral named ${referralPathwayVersionId} as the pathway to run, so the choice was made before this screen was opened. It travels on the referral record.`}
          changedBy={
            changedFromReferral
              ? `Choosing ${referralPathwayVersionId} again returns to what was decided when the referral was accepted.`
              : "Choosing a different version below changes what was decided when the referral was accepted."
          }
          icon={<FileCheck2 aria-hidden="true" className="size-icon-md shrink-0" />}
        />
      ) : (
        <StatedReason
          heading="The pathway named on the referral cannot be used"
          because={`Accepting this referral named ${referralPathwayVersionId}, and that version is not one this team can start a plan on now — a version that is still being written, still in review, or retired is not offered here.`}
          changedBy="Choosing one of the approved versions below replaces it. If none is listed, a version has to be approved before any plan can start."
          icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
        />
      )}

      {options.length === 0 ? (
        <ListEmptyState
          kind="no-data"
          heading="No approved pathway yet"
          explanation="A plan can only run a pathway version that two different people have approved. Nothing this team may read has reached that point, so there is nothing to choose between here."
        />
      ) : (
        <div className={panelClass}>
          <fieldset className="min-w-0 border-0 p-0">
            <legend className={headingClass}>Choose a governed pathway version</legend>
            <p className={`mt-1 ${mutedTextClass}`}>
              Every version listed has been approved by two different people. Nothing here is ranked or recommended, and
              the order carries no meaning.
            </p>
            <div className="mt-3 min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)]">
              {options.map((option) => {
                // The `<label>` holds the version's name and nothing else, and the two descriptive
                // lines sit outside it, tied on with `aria-describedby`. Nesting them inside the
                // label made the accessible name the whole paragraph — the shape
                // `jsx-a11y/label-has-associated-control` rejected, and rightly: a screen reader
                // announcing every radio's approval history as its name is unusable.
                const inputId = `caring-contacts-pathway-${option.id}`;
                const detailId = `${inputId}-detail`;
                return (
                  <div key={option.id} className={optionRowClass}>
                    <label htmlFor={inputId} className={optionLabelClass}>
                      <input
                        type="radio"
                        id={inputId}
                        name="caring-contacts-pathway-version"
                        value={option.id}
                        checked={chosen === option.id}
                        onChange={() => onChoose(option.id)}
                        aria-describedby={detailId}
                        className="size-5 shrink-0 accent-[color:var(--clinical-accent)]"
                      />
                      <span className="min-w-0 break-words text-sm font-semibold text-[color:var(--text-heading)]">
                        {option.id}
                      </span>
                    </label>
                    <div id={detailId} className="min-w-0 pb-1 pl-8">
                      <p className="text-sm leading-6 text-[color:var(--text-muted)]">
                        {option.cadenceLabels.join(" · ")}
                      </p>
                      <p className="mt-1 text-xs leading-5 text-[color:var(--text-muted)]">
                        Approved by {option.approvedBy.join(" and ")}
                        {option.publishedAt === null
                          ? ", not yet published"
                          : `, published ${awstDateWording(option.publishedAt)}`}
                        {option.id === referralPathwayVersionId ? ". Named on the referral." : ""}
                      </p>
                      {/*
                        Ruling [126]. The line above states who approved this version, and for a
                        demonstration version nobody did. It is rendered as its own line rather than
                        appended to that sentence so it cannot be read as part of the approval, and
                        it is inside the same `aria-describedby` region so a screen reader hears it
                        with the option rather than after it.
                      */}
                      {option.provenanceNote === null ? null : (
                        <p
                          data-testid={PATHWAY_PROVENANCE_TESTID}
                          className="mt-1 text-xs leading-5 font-semibold text-[color:var(--text-heading)]"
                        >
                          {option.provenanceNote}
                        </p>
                      )}
                      {/*
                        `pathway-preview` — the frozen matrix's row for this stage, and the ONE row
                        of the eight whose Mutation column reads Yes where its name suggests
                        otherwise. Its decision is "Use this pathway", so confirming it CHOOSES the
                        version; the radio above and this control are two ways to the same write,
                        and this one states what is being chosen before it is chosen.

                        WHAT THE DRAWER CAN AND CANNOT SAY, on the same limit Task 10 recorded for
                        `delivery-detail`: `OverlayHost` renders each row's frozen summary and takes
                        no children, so the drawer cannot name the version it was opened from. The
                        version's own cadence and approvals therefore stay on this row, above, and
                        the control's visible words promise only what the drawer holds — the
                        version follows as the control's ORIGIN, which is what tells one row's
                        control from another's for a reader who cannot see which row it sits in.
                      */}
                      <div className="mt-2 min-w-0">
                        <WorkspaceOverlayTrigger
                          overlayId="pathway-preview"
                          commit={pathwayPreviewCommit(option.id)}
                          className="w-full sm:w-auto"
                        >
                          <span className="truncate">Read the pathway in full, then use it</span>
                          <span className="sr-only"> &mdash; opened from the {option.id} row</span>
                        </WorkspaceOverlayTrigger>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
        </div>
      )}

      <div className="flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <button type="button" onClick={onBack} className={secondaryControlClass}>
          <span className="truncate">Back to agreement</span>
        </button>
        <ForwardControl from="pathway" ready={chosen !== null} onContinue={onContinue} />
      </div>
    </section>
  );
}

/**
 * Stage 3 — the patient's details, and when in the day messages go out.
 *
 * RULING [114], AND IT IS THE WHOLE SHAPE OF THIS STAGE. The approved mockup draws this screen as a
 * CONFIRMATION: four read-only rows — preferred name, message variant, team identity, coordinator
 * signature — each with a green tick and the source line "Imported from the synthetic referral".
 * Not one of them is reproducible AS AN IMPORT. `createPlanSchema.patientDetail` requires the
 * clinician to SUPPLY `patientName` and `patientMobileNumber` (both `min(1)`), plus identifiers,
 * cultural identity and the preferred name, and a `Referral` is five fields holding none of them
 * (Ruling [112]). There is nothing to import and nothing to tick, so this is a DATA ENTRY stage: it
 * is where a clinician types a person's name, what to call them, and a mobile number. Presenting
 * that typing as an imported governed value would be a lie about provenance on the screen that
 * decides where messages physically go.
 *
 * THE MOCKUP'S "preferred name" ROW IS NOW COLLECTED, AND ONLY THE PROVENANCE CHANGED (owner
 * decision, 2026-08-26). The design shows it arriving from the hospital record; it is typed here
 * instead, and it is asked as its own question rather than derived from `patientName` — see the
 * field's own comment for the four ordinary Perth names that a split gets wrong. That reduces the
 * design's list of values imported from a record this system is not connected to; it does not
 * resolve the others.
 *
 * This is the third stage of this wizard whose approved design pictures a system reading from a
 * hospital record it is not connected to. The design is a specification for the product; the types
 * are a specification for what exists. Where they disagree the types win.
 *
 * WHAT IS KEPT FROM THE MOCKUP: the sending-preference fieldset, which matches
 * `sendingPreference: z.enum(["morning", "afternoon", "earlyEvening"])` exactly. Its legend does
 * not survive: "One preference applies to all 10 contacts" restates a count that is derived and
 * conditional (Ruling [98] — Week 1 is absorbed when the first contact falls on discharge + 7), so
 * the property is stated and the number is not (Ruling [94]).
 *
 * THE PREVIEW CARD THE MOCKUP DRAWS IS HERE, AND ITS WORDING IS READ RATHER THAN WRITTEN.
 * Patient-visible copy is frozen and belongs to the sealed domain's `message-copy`; a screen that
 * hardcoded one of those strings would be a defect even with the string correct, because it would
 * put the owner's pending decisions in two places. So the wording arrives as a prop the server
 * resolved from that module, and this stage renders it as it arrives and says, in place, that it is
 * a specimen carrying its own example name rather than the one entered above.
 *
 * AND NOTHING IS VALIDATED TWICE. The decisions about a value — what is required, what is trimmed,
 * what reaches a plan as null — live in `patient-detail.ts`, because Task 9 needs the identical
 * decisions when it assembles the create call.
 */
function PersonalisationStage({
  detail,
  intake,
  sendingPreference,
  sendingPreferenceOptions,
  fictionalPatientMobileNumbers,
  patientVisibleMessageSpecimen,
  preferenceGivenOnStaffedLine,
  communicationPreferenceCommit,
  mobileCheck,
  onDetailChange,
  onSendingPreferenceChange,
  onBack,
  onContinue,
}: {
  detail: PlanPatientDetailDraft;
  intake: ReferralIntakePayload | null;
  sendingPreference: SendingPreference | null;
  sendingPreferenceOptions: readonly SendingPreferenceOption[];
  fictionalPatientMobileNumbers: readonly string[];
  /** The sealed domain's patient-visible wording, resolved on the server. Rendered as it arrives. */
  patientVisibleMessageSpecimen: string;
  /** Whether `communication-preference` has been confirmed. Held in the draft, on no plan. */
  preferenceGivenOnStaffedLine: boolean;
  communicationPreferenceCommit: WorkspaceOverlayCommit;
  /** The second entry of the mobile number and the shared-number check. Held by the wizard, never in the draft. */
  mobileCheck: MobileNumberCheck;
  onDetailChange: (change: Partial<PlanPatientDetailDraft>) => void;
  onSendingPreferenceChange: (preference: SendingPreference) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const issues = personalisationIssues({ detail, sendingPreference });
  const issueFor = (field: PersonalisationField) => issues.find((issue) => issue.field === field) ?? null;
  // The number typed twice and checked against the team's other plans is a condition on CONTINUING,
  // not a property of the draft, so it is added here rather than to `personalisationIssues`.
  const mobileCheckReason = mobileCheck.blockingReason;
  const complete = issues.length === 0 && !mobileCheck.blocked;

  // The number is accepted whatever it is; this only decides what the screen SAYS about it.
  const mobileValid = issueFor("patientMobileNumber") === null;
  const mobileIsReserved = mobileIsDesignatedFictional(detail.patientMobileNumber, fictionalPatientMobileNumbers);

  return (
    <section aria-label="Personalisation" className="flex min-w-0 flex-col gap-5">
      <div className={panelClass}>
        <h2 className={headingClass}>{intake ? "Check the person\u2019s details" : "Entered by you"}</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          {intake
            ? "The name, mobile number and identifier below were filled in from what was recorded when this referral was entered at intake. Check them with the person and correct anything that is wrong. The name to use in messages is not filled in: ask the person."
            : "This referral was saved without a name or mobile number, so nothing here was read from a record."}{" "}
          What is here when you continue is what the plan will hold, and until you finish or discard it is kept on this
          computer — the notice above this stage says exactly where.
        </p>

        <div className="mt-4 flex min-w-0 flex-col gap-5">
          <TextField
            id="caring-contacts-patient-name"
            label="Patient&rsquo;s name"
            value={detail.patientName}
            requirement={issueFor("patientName")?.message ?? null}
            onChange={(value) => onDetailChange({ patientName: value })}
            autoComplete="off"
          />

          {/*
            THE MESSAGE'S NAME IS ASKED FOR, NOT TAKEN FROM THE FIELD ABOVE (owner decision,
            2026-08-26) — and this is the one place a later editor is most likely to "simplify" it
            back, so the reason is here rather than only in the module.

            The field above is one free-text box. Splitting it at the first space greets a person
            with one name by their only name, a person whose family name is written first by their
            surname, `Mr John Smith` as "Mr", and a person with two given names by half of them.
            Every one of those is ordinary in Perth rather than exotic. A suicide-prevention message
            that opens with someone's surname, or with a title, is worse than one that uses no name
            at all — so the person actually speaking to the patient types what to call them, and
            nothing in this codebase parses a name.
          */}
          <TextField
            id="caring-contacts-preferred-name"
            label="What should we call them in messages?"
            hint="Ask the person. This is the word each message opens with, so it is asked for rather than taken from the name above — a name written family-name-first, or with a title, would open the message with the wrong word."
            value={detail.preferredName}
            requirement={issueFor("preferredName")?.message ?? null}
            onChange={(value) => onDetailChange({ preferredName: value })}
            autoComplete="off"
          />

          <div className="flex min-w-0 flex-col gap-3">
            <TextField
              id="caring-contacts-patient-mobile"
              label="Mobile number this plan will use"
              value={detail.patientMobileNumber}
              requirement={issueFor("patientMobileNumber")?.message ?? null}
              onChange={(value) => onDetailChange({ patientMobileNumber: value })}
              inputMode="tel"
              autoComplete="off"
              describedBy={MOBILE_CAUTION_ID}
            />
            {/*
              RULING [115]. This is the field that decides where a message physically goes, and a
              clinician who believes it reaches a real handset is the single most dangerous
              misunderstanding this interface can create. So the statement is in the flow of the
              page, in spec §4.4's shape, beside the field it is about — never a `title` attribute,
              which has not been stated to anyone who does not hover.
            */}
            <StatedReason
              heading="Nothing typed here is ever sent to any number"
              because={`This is a prototype and it is connected to no messaging provider, so no message leaves this workspace for any handset. The numbers its own material uses are reserved fictional ones that can never connect to a real person: ${fictionalPatientMobileNumbers.join(" and ")}.`}
              changedBy="Nothing on this screen. Sending would need a provider this prototype does not have, and a governance decision that has not been made."
              icon={<PhoneOff aria-hidden="true" className="size-icon-md shrink-0" />}
            />
            {/*
              THE REGION IS ALWAYS RENDERED AND ITS CHILDREN CHANGE — round 1, finding I-2.

              The first version created this whole `<p role="status">` when the condition became
              true. A live region inserted along with its content is unreliably announced: the
              region must already be on the page for a content change to be spoken. So the caution
              telling a clinician the number they typed is not a reserved fictional one was the one
              string on this screen a screen-reader user might never hear — on the field that
              decides where a message physically goes. It is also named in the input's
              `aria-describedby`, so it is reachable from the control rather than only as a region
              somebody has to go and find.

              This is what makes ACCEPTING a non-reserved number the right call rather than a soft
              one: the whole protection is the statement, so the statement has to actually arrive.
            */}
            <p id={MOBILE_CAUTION_ID} data-testid={MOBILE_CAUTION_ID} role="status" className={mutedTextClass}>
              {mobileValid && !mobileIsReserved
                ? "The number entered is not one of the reserved fictional numbers listed above. It is a valid mobile number and is accepted, but a number belonging to a real person would be recorded on the plan."
                : ""}
            </p>
            <MobileConfirmationFields
              id="caring-contacts-patient-mobile-again"
              check={mobileCheck}
              inputClassName={fieldClass}
              labelClassName="text-sm font-medium text-[color:var(--text-heading)]"
              textClassName={mutedTextClass}
            />
          </div>

          <TextAreaField
            id="caring-contacts-patient-identifiers"
            label="Other identifiers this service uses"
            hint="One per line. Leave it blank if there are none — the plan then records no others."
            value={detail.patientIdentifiers}
            onChange={(value) => onDetailChange({ patientIdentifiers: value })}
          />

          {/*
            CULTURAL IDENTITY IS NOT ASKED FOR, AND THE ABSENCE IS STATED (owner decision,
            2026-08-25, round 1).

            What shipped first was a free-text input with spec §2.5's purpose stated beneath it. The
            owner removed it, and the reasoning matters more than the instruction. §2.5 records the
            status as IMPORTED from the source record and used for aggregate reach reporting only.
            There is no source record and no import here, so the field had quietly become something
            a clinician types — and free text cannot deliver what §2.5 promises, because small-cell
            suppression presupposes a bounded category set. Unbounded values mean either every rare
            spelling is a cell of one and suppression eats the report, or an unaudited normalisation
            step decides who counts as Aboriginal, WHICH IS ITSELF A GOVERNANCE DECISION NOBODY HAS
            MADE. A bare "Cultural identity (optional)" label also invites religion, language or
            country of birth — wider collection than §2.5 authorised, on a suicide-prevention screen.

            NOT replaced with a category picker: choosing the categories is exactly the deferred
            decision. The field stays nullable in the schema and in the draft, the storage and
            `cultural_identity_reports` are untouched (Task 19's), and `createPlanPatientDetail`
            sends null.

            AND THE STATEMENT IS NOT SILENT ABOUT WHY. An absent field with no explanation reads as
            an oversight, which is the same failure spec §4.4 exists to prevent one direction over.
            The wording below also fixes I-3: the removed panel said the field "IS used for
            aggregate reporting on programme reach" — present tense, for a report nobody has built.
            That was the same class of defect as §2.5's "imported from the source record", which
            this screen had correctly refused to reproduce one sentence earlier.
          */}
          <StatedReason
            heading="Cultural identity is not asked for here"
            because="The design for this service records cultural identity as something read from the hospital record, and used only for counting how many people the programme reaches — never for who is eligible, the timing of anything, which pathway runs, or what a message says. This prototype is connected to no hospital record, so the only way to have it would be to ask you to type it, and typed free text cannot support the small-number suppression that reporting would depend on."
            changedBy="Nothing on this screen. It needs the record it is meant to be read from, and a decision about which identities are recorded — neither of which has been made. Until then the plan records nothing here."
            icon={<MessageSquareText aria-hidden="true" className="size-icon-md shrink-0" />}
          />
        </div>
      </div>

      <div className={panelClass}>
        <fieldset className="min-w-0 border-0 p-0">
          <legend className={headingClass}>When in the day messages go out</legend>
          {/*
            Ruling [94] and Ruling [98]: the mockup's "One preference applies to all 10 contacts"
            restates a count that is DERIVED and CONDITIONAL, so the invariant is stated instead.
          */}
          <p className={`mt-1 ${mutedTextClass}`}>
            One choice applies to every contact in this plan. The times are the approved AWST send times this programme
            uses; nothing here can put a message outside them.
          </p>
          <div className="mt-3 min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)]">
            {sendingPreferenceOptions.map((option) => {
              const inputId = `caring-contacts-sending-${option.preference}`;
              const detailId = `${inputId}-detail`;
              return (
                <div key={option.preference} className={optionRowClass}>
                  {/*
                    `min-h-tap` on the LABEL, which is what a tap activates — round 1, finding I-2.
                    The send time sits outside it and is tied on with `aria-describedby`, so the
                    radio's accessible name stays the choice rather than the choice plus a time.
                  */}
                  <label htmlFor={inputId} className={optionLabelClass}>
                    <input
                      type="radio"
                      id={inputId}
                      name="caring-contacts-sending-preference"
                      value={option.preference}
                      checked={sendingPreference === option.preference}
                      onChange={() => onSendingPreferenceChange(option.preference)}
                      aria-describedby={detailId}
                      className="size-5 shrink-0 accent-[color:var(--clinical-accent)]"
                    />
                    <span className="min-w-0 break-words text-sm font-semibold text-[color:var(--text-heading)]">
                      {option.label}
                    </span>
                  </label>
                  <p id={detailId} className="min-w-0 pb-1 pl-8 text-sm leading-6 text-[color:var(--text-muted)]">
                    {option.sendTime}
                  </p>
                </div>
              );
            })}
          </div>
          {issueFor("sendingPreference") === null ? null : (
            <p className={`mt-2 ${mutedTextClass}`}>{issueFor("sendingPreference")?.message}</p>
          )}
        </fieldset>

        {/*
          `communication-preference` — where the choice above CAME FROM, which is a different fact
          from the choice itself and is the one the frozen row is about: "Record only a preference
          the patient gave through the staffed programme phone."

          Why it can only have come from there, said rather than assumed: this workspace receives
          nothing. The number a patient would be written to is one-way, no one reads replies to it,
          and no screen here shows anything a patient said. So a preference the patient themselves
          asked for reached this service by the staffed phone or it did not reach it at all — and if
          it did not, the choice above is the coordinator's, which is a legitimate thing to record
          and a different thing to record.
        */}
        <div className="mt-4 flex min-w-0 flex-col gap-3 border-t border-[color:var(--border)] pt-4">
          <p role="status" className={mutedTextClass} data-testid="caring-contacts-preference-source">
            {preferenceGivenOnStaffedLine
              ? "You have recorded that the patient asked for this time through the staffed programme phone. That is kept on this computer for this tab, with the rest of this sign-up, and is written onto no plan — this system has no field for it."
              : "Nothing says where this choice came from. Unless the patient asked for it through the staffed programme phone, it is your choice on their behalf, and this screen does not assume either."}
          </p>
          <div className="flex min-w-0 flex-wrap gap-3">
            <WorkspaceOverlayTrigger
              overlayId="communication-preference"
              commit={communicationPreferenceCommit}
              className={secondaryControlClass}
            >
              <PhoneOff aria-hidden="true" className="size-icon-md shrink-0" />
              <span className="truncate">The patient asked for this time</span>
            </WorkspaceOverlayTrigger>
          </div>
        </div>
      </div>

      {/*
        `message-preview` — the row the approved mockup draws as a preview card on this stage.

        THE WORDING IS READ, NEVER ASSEMBLED. `patientVisibleMessageSpecimen` is
        `EXACT_PATIENT_VISIBLE_MESSAGE` from the sealed domain, resolved on the server and rendered
        exactly as it arrives. Nothing here interpolates a name, splits the string, or writes a word
        of it: patient-visible copy is frozen, and a screen that composed one would be a defect even
        with the result correct.

        AND IT IS A SPECIMEN, WHICH THE PANEL SAYS RATHER THAN LEAVING TO BE NOTICED. The frozen
        wording carries a name of its own and has no slot for the one typed above, so it is not this
        patient's message and must not be presented as one. That gap is the sealed domain's to
        close; this screen states it instead of filling it.

        The overlay beside it is `mutatesState: false` and its decision is "Back to personalisation"
        — an exit — so it takes `ExitOnlyOverlayTrigger`, whose module records why an inline no-op
        and `{ kind: "unavailable" }` are both the wrong answer for a row like this.
      */}
      <div className={panelClass}>
        <h2 className={headingClass}>The wording a patient would receive</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          This is the governed wording itself, shown as it stands in the approved copy. It is a specimen: it carries its
          own example name rather than the name entered above, so read it for what a message says and not for what this
          patient&rsquo;s would say. Nothing in this prototype is ever sent to any number.
        </p>
        <p
          data-testid="caring-contacts-message-specimen"
          className="mt-3 max-w-[var(--measure)] whitespace-pre-line rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 text-sm leading-6 text-[color:var(--text)] forced-colors:border-[CanvasText]"
        >
          {patientVisibleMessageSpecimen}
        </p>
        <div className="mt-3 min-w-0">
          <ExitOnlyOverlayTrigger overlayId="message-preview" className="w-full sm:w-auto">
            <span className="truncate">What a preview does and does not show</span>
          </ExitOnlyOverlayTrigger>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-2">
        <p role="status" className={mutedTextClass}>
          {complete
            ? "The name, the mobile number and the sending preference are all entered, so nothing else is needed on this stage. None of it is recorded on a plan yet; like everything else on this screen it is kept on this computer until you finish or discard."
            : `Before this plan can be reviewed: ${[
                ...issues.map((issue) => issue.message),
                ...(mobileCheckReason === null ? [] : [mobileCheckReason]),
              ].join(" ")}`}
        </p>
        <div className="flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" onClick={onBack} className={secondaryControlClass}>
            <span className="truncate">Back to pathway</span>
          </button>
          <ForwardControl from="personalisation" ready={complete} onContinue={onContinue} />
        </div>
      </div>
    </section>
  );
}

function ReviewStage({
  referralId,
  patientId,
  teamId,
  actorId,
  actorRoleLabels,
  assurances,
  detail,
  intake,
  pathwayVersionId,
  sendingPreference,
  sendingPreferenceOptions,
  activation,
  submission,
  state,
  onActivationChange,
  onActivate,
  onBack,
}: {
  referralId: string;
  patientId: string;
  teamId: string;
  actorId: string;
  actorRoleLabels: readonly string[];
  assurances: PlanDraftAssurances;
  detail: PlanPatientDetailDraft;
  intake: ReferralIntakePayload | null;
  pathwayVersionId: string | null;
  sendingPreference: SendingPreference | null;
  sendingPreferenceOptions: readonly SendingPreferenceOption[];
  activation: PlanActivationDraft;
  submission: PlanSubmissionIdentity | null;
  state: PlanSubmissionState;
  onActivationChange: (change: Partial<PlanActivationDraft>) => void;
  /**
   * Typed as returning a promise because it does. `WorkspaceOverlayCommit.record` admits one
   * deliberately -- the host can then observe a rejection rather than leave it unhandled -- and
   * narrowing this to bare `void` here would have hidden that from the type system while the
   * runtime went on returning one.
   */
  onActivate: () => void | Promise<void>;
  onBack: () => void;
}) {
  const preview = planSchedulePreview({ activation, sendingPreference });
  // The consequence of the day now chosen, answered WITHOUT waiting for the reason (round 2, I3).
  // A clinician must see that a day costs a contact while choosing it, not after justifying it.
  const consequence = firstContactConsequence({ activation, sendingPreference });
  const bounds = firstContactDayBounds(activation.dischargeDay.trim());
  const dischargeRange = dischargeDayBounds();
  const reasonRequired = firstContactReasonIsRequired({
    dischargeDay: activation.dischargeDay,
    firstContactDay: activation.firstContactDay,
  });
  const patientDetail = createPlanPatientDetail(detail);
  const body = createPlanRequestBody({
    submission,
    referralId,
    patientId,
    pathwayVersionId,
    activation,
    sendingPreference,
    patientDetail,
    assurances,
  });
  const chosenPreference = sendingPreferenceOptions.find((option) => option.preference === sendingPreference) ?? null;

  return (
    <section aria-label="Review and activation" className="flex min-w-0 flex-col gap-5">
      <div className={panelClass}>
        <h2 className={headingClass}>Read back before this plan is created</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          Every line below is what this plan will hold, with where it came from. Nothing here is a count this screen was
          told; the schedule further down is worked out from the dates you choose.
        </p>
        <div className="mt-3 min-w-0">
          <SourcedFact
            icon={<IdCard aria-hidden="true" className="size-icon-md" />}
            label="Referral"
            value={referralId}
            source="Read from the referral record"
          />
          <SourcedFact
            icon={<IdCard aria-hidden="true" className="size-icon-md" />}
            label="Patient identifier"
            value={patientId}
            source="Read from the referral record"
          />
          <SourcedFact
            icon={<UserRoundCheck aria-hidden="true" className="size-icon-md" />}
            label="Patient&rsquo;s name"
            value={detail.patientName.trim() === "" ? "Not entered" : detail.patientName.trim()}
            source={
              carriedFromIntake(detail.patientName, intakePatientName(intake))
                ? "Carried over from the referral intake and checked by you at personalisation."
                : "Entered by you at personalisation."
            }
          />
          <SourcedFact
            icon={<UserRoundCheck aria-hidden="true" className="size-icon-md" />}
            label="Called this in messages"
            value={detail.preferredName.trim() === "" ? "Not entered" : detail.preferredName.trim()}
            source="Entered by you at personalisation, from what the person asked to be called. Never taken from the name above."
          />
          <SourcedFact
            icon={<PhoneOff aria-hidden="true" className="size-icon-md" />}
            label="Mobile number this plan will use"
            value={detail.patientMobileNumber.trim() === "" ? "Not entered" : detail.patientMobileNumber.trim()}
            source={
              carriedFromIntake(detail.patientMobileNumber, intake?.mobileNumber)
                ? "Carried over from the referral intake and checked by you at personalisation. Nothing is ever sent to it from this prototype."
                : "Entered by you at personalisation. Nothing is ever sent to it from this prototype."
            }
          />
          <SourcedFact
            icon={<IdCard aria-hidden="true" className="size-icon-md" />}
            label="Other identifiers"
            value={
              parsePatientIdentifiers(detail.patientIdentifiers).length === 0
                ? "None given"
                : parsePatientIdentifiers(detail.patientIdentifiers).join(", ")
            }
            source={
              carriedFromIntake(detail.patientIdentifiers, intake?.patientIdentifier)
                ? "Carried over from the referral intake and checked by you at personalisation"
                : "Entered by you at personalisation"
            }
          />
          <SourcedFact
            icon={<ShieldCheck aria-hidden="true" className="size-icon-md" />}
            label="Owning team"
            value={teamId}
            source="Read from the referral record, which this team accepted"
          />
          <SourcedFact
            icon={<UserRoundCheck aria-hidden="true" className="size-icon-md" />}
            label="Acting as"
            value={`${actorId} — ${actorRoleLabels.join(", ")}`}
            source="Read from the session you are signed in with"
          />
          <SourcedFact
            icon={<FileCheck2 aria-hidden="true" className="size-icon-md" />}
            label="Governed pathway version"
            value={pathwayVersionId ?? "Not chosen"}
            source="Chosen by you at the pathway stage, from versions two different people approved"
          />
          <SourcedFact
            icon={<MessageSquareText aria-hidden="true" className="size-icon-md" />}
            label="When in the day messages go out"
            value={
              chosenPreference === null ? "Not chosen" : `${chosenPreference.label} — ${chosenPreference.sendTime}`
            }
            source="Chosen by you at personalisation. One choice applies to every contact in this plan."
          />
        </div>
      </div>

      {/*
        RULING [119], AND IT IS THE SENTENCE THIS SCREEN EXISTS TO GET RIGHT.

        The approved mockup renders `Agreement confirmed: Yes` beside the patient's name, in a row
        of read-back cards, which presents the patient's agreement as a fact the plan holds. That is
        still not one, and this is still the last surface before the plan exists, so telling a
        coordinator the consent question is handled is still the worst available failure here.

        WHAT CHANGED IN TASK 9B, AND WHAT DID NOT. The request now carries the confirmations and the
        plan records an attestation for each: that this coordinator confirmed this check, and when.
        So the old sentence — "they are not recorded on the plan" — is now false and has gone. What
        has NOT changed is the claim the mockup makes: an attestation is evidence that a check
        happened, not evidence of what the patient agreed to, and agreement lives in the hospital
        record rather than here.

        This is also the payoff of stating today's fact rather than a permanent property. "Not
        recorded on the plan" was true when written and false in one place afterwards; "nothing in
        this domain records them" would have had to be hunted for across four screens.
      */}
      <StatedReason
        heading={
          everyAssuranceConfirmed(assurances)
            ? "Both confirmations were made by you, and the plan will record them"
            : "The confirmations at the start of this sign-up are not all ticked"
        }
        because={
          everyAssuranceConfirmed(assurances)
            ? "You confirmed that the patient agreed to receive caring contacts, and that the number is the patient's own. Creating the plan records each of those on the plan as your confirmation, with who you are acting as and the time. What is recorded is that you confirmed the patient agreed — not the agreement itself, which is held in the patient's hospital record and not here."
            : // NAMES WHICH ONE IS MISSING, and that is the point of the helper rather than a phrasing
              // preference. The first version said "at least one of the confirmations is not ticked",
              // which tells a coordinator they are blocked without telling them by what — on the one
              // screen whose only remedy is to go back a stage and hunt for it.
              unconfirmedAssuranceSentence(assurances)
        }
        changedBy="Going back to the agreement stage changes what you confirmed, and so changes what the plan will record."
        icon={<ClipboardCheck aria-hidden="true" className="size-icon-md shrink-0" />}
      />

      <div className={panelClass}>
        <h2 className={headingClass}>Discharge, and the day of the first contact</h2>
        <p className={`mt-1 ${mutedTextClass}`}>
          These two belong together: every date in this plan is counted from the discharge day, and the first contact is
          chosen relative to it.
        </p>

        <div className="mt-4 grid min-w-0 gap-5 sm:grid-cols-2">
          <DateField
            id="caring-contacts-discharge-day"
            label="Day the patient was discharged"
            value={activation.dischargeDay}
            onChange={(value) => onActivationChange({ dischargeDay: value })}
            min={dischargeRange.earliest}
            max={dischargeRange.latest}
            hint={
              bounds === null
                ? `AWST, from ${dischargeRange.earliest} to today. Every date in this plan is counted from it, and the day of the first contact cannot be chosen until it is entered.`
                : `AWST, from ${dischargeRange.earliest} to today. Every date in this plan is counted from it.`
            }
          />
          <DateField
            id="caring-contacts-first-contact-day"
            label="Day of the first contact"
            value={bounds === null ? "" : activation.firstContactDay === "" ? bounds.usual : activation.firstContactDay}
            onChange={(value) => onActivationChange({ firstContactDay: value })}
            min={bounds?.earliest}
            max={bounds?.latest}
            disabled={bounds === null}
            hint={
              bounds === null
                ? "Enter the discharge day first. This day can only be chosen relative to it."
                : `Usually ${bounds.usual}, the day after discharge. It can be moved from ${bounds.earliest} to ${bounds.latest}.`
            }
          />
        </div>

        {/*
          THE DISCHARGE DAY IS ASKED FOR, AND THE ABSENCE OF A SOURCE IS STATED (Ruling [121]).
          An input for a fact the approved design shows arriving from a hospital record reads as an
          oversight unless the screen says why it is being typed. This is the fourth such field in
          one wizard — stage 1's identity, stage 3's personalisation, the mobile number, and now
          this — and the pattern is recorded in the build record rather than rediscovered each time.
        */}
        <div className="mt-4 min-w-0">
          <StatedReason
            heading="The discharge day has to be typed here"
            because="A plan cannot be created without it: every contact date in the twelve months is counted from the discharge day in AWST. The design for this service reads it from the hospital record, and this prototype is connected to no hospital record, so there is nowhere for it to come from but you."
            changedBy="Nothing on this screen. It needs the record it is meant to be read from, and that connection has not been built."
            icon={<CalendarDays aria-hidden="true" className="size-icon-md shrink-0" />}
          />
        </div>

        {reasonRequired ? (
          <div className="mt-4 min-w-0">
            <TextAreaField
              id="caring-contacts-first-contact-reason"
              label="Why the first contact is not on the usual day"
              hint={`Recorded on the plan, and read back on the patient's screen. Up to ${FIRST_CONTACT_REASON_MAX_LENGTH} characters — a few sentences.`}
              value={activation.firstContactReason}
              onChange={(value) => onActivationChange({ firstContactReason: value })}
            />
          </div>
        ) : null}

        {/*
          THE CONSEQUENCE, IN PLACE, BEFORE THE CHOICE IS COMMITTED (Ruling [118]).

          Moving the first contact to discharge + 7 puts it on the same calendar day as the Week 1
          contact, and two caring contacts must never land on one day — so the schedule keeps one and
          the plan sends nine rather than ten. That is the system removing a message from a
          suicide-prevention schedule as a side effect of a date choice, and §4.4's explained-
          automation contract is at its sharpest here: it has to be said while the date is being
          chosen, not reported afterwards.
        */}
        <div className="mt-4 flex min-w-0 flex-col gap-3">
          {preview.kind === "incomplete"
            ? preview.issues.map((issue) => (
                <p key={issue.code} className={mutedTextClass}>
                  {issue.message}
                </p>
              ))
            : null}
          {preview.kind === "refused" ? <RefusalStatement refusal={preview.refusal} /> : null}
          {consequence === null
            ? null
            : consequence.absorbed.map((contact) => (
                <AutomatedState
                  key={contact.sequence}
                  state="Suppressed"
                  because={`${contact.cadenceLabel} falls on the same calendar day as the first contact you have chosen, and two caring contacts must never land on one day, so the schedule keeps one of them. This plan will send ${consequence.summary.stillToSend} messages rather than ${consequence.summary.total}.`}
                  changedBy="Choosing an earlier day for the first contact puts this message back into the schedule."
                />
              ))}
        </div>
      </div>

      <div className={panelClass}>
        <h2 className={headingClass}>The schedule this plan will run</h2>
        {preview.kind === "ready" ? (
          <>
            <p data-testid="caring-contacts-activation-schedule-summary" className={`mt-1 ${mutedTextClass}`}>
              {plannedScheduleSentence(preview.summary)}
            </p>
            <ul aria-label="Twelve-month schedule" className="mt-3 flex min-w-0 flex-col gap-2">
              {preview.contacts.map((contact) => {
                const willNotBeSent = preview.absorbed.some((entry) => entry.sequence === contact.sequence);
                return (
                  <li
                    key={contact.sequence}
                    className="min-w-0 rounded-[var(--radius-md)] border border-[color:var(--border)] bg-[color:var(--surface-subtle)] px-3 py-2 forced-colors:border-[CanvasText]"
                  >
                    <p className="min-w-0 text-sm font-semibold text-[color:var(--text-heading)]">
                      {contact.cadenceLabel} &middot; {contact.calendarDay} (AWST)
                    </p>
                    <p className="mt-0.5 text-sm leading-6 text-[color:var(--text-muted)]">
                      {PLANNED_MESSAGE_TYPE_LABELS[contact.messageType]}
                      {willNotBeSent ? " · will not be sent" : ""}
                    </p>
                    {contact.messageType === "closing" ? (
                      <p className="mt-0.5 max-w-[var(--measure)] text-xs leading-5 text-[color:var(--text-muted)]">
                        The last message in the plan. It closes the twelve months and is not one more caring contact.
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {/*
              No message TEXT is rendered here. Patient-visible copy is frozen and belongs to the
              sealed domain's `message-copy`; a screen that hardcoded one of those strings would be a
              defect even with the string correct. Stage 3 shows the governed wording, read from that
              module and labelled as the specimen it is; this stage reads back what was decided.
            */}
            <p className={`mt-3 ${mutedTextClass}`}>
              The wording of each message comes from the governed pathway version above, not from this screen. Nothing
              in this prototype is ever sent to any number.
            </p>
          </>
        ) : (
          <p className={`mt-1 ${mutedTextClass}`}>
            The schedule is worked out from the discharge day and the day of the first contact. It appears here as soon
            as both are settled, so nothing about this plan is a number you have to take on trust.
          </p>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {/*
          WHAT CONFIRMING DOES, said before the control rather than after it, and PINNED BY TESTS.

          Both writes, named: the plan is created and then started. The previous version of this
          told a coordinator the plan would not run and that the starting step did not exist, while
          the control beside it did exactly that and the overlay it opens said "Last check before
          the plan starts". Three statements on one screen disagreeing about the same fact, and no
          test read any of them — which is why it survived the code changing underneath it.
        */}
        <StatedReason
          heading="Confirming creates this plan and starts it, and nothing is ever sent from here"
          because="Confirming does two things, one after the other: it creates the plan, the patient's details and the whole twelve-month schedule above, and then it starts the plan so that schedule is running. Both are recorded against you on the access trail. Nothing reaches any handset either way — this prototype is connected to no messaging provider and has nothing that sends."
          changedBy="Nothing on this screen once you confirm; the plan and its schedule are then on the patient's own screen. If the plan is created and cannot be started, this screen says so and confirming again finishes the same plan rather than creating another."
          icon={<CircleAlert aria-hidden="true" className="size-icon-md shrink-0" />}
        />

        {state.status === "refused" ? <RefusalStatement refusal={state.refusal} /> : null}
        {/*
          THE HALF-DONE STATE IS RENDERED AS ITS OWN THING (Ruling [123]). It reads from
          `activationRefusalWording`, whose every branch says the plan exists, that it has not
          started, and that pressing again finishes the same plan rather than making another.
        */}
        {state.status === "created-not-started" ? (
          <RefusalStatement refusal={state.refusal} wording={activationRefusalWording} />
        ) : null}

        <p role="status" className={mutedTextClass}>
          {state.status === "sending"
            ? "Creating the plan and starting it. Nothing is finished until this says so."
            : state.status === "refused"
              ? "The plan was not created. Everything you entered is still on this computer."
              : state.status === "created-not-started"
                ? "The plan was created and has not started. This sign-up is still on this computer, so confirming again finishes the same plan."
                : ""}
        </p>

        <div className="flex min-w-0 flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          <button type="button" onClick={onBack} className={secondaryControlClass}>
            <span className="truncate">Back to personalisation</span>
          </button>
          {/*
            THE ONE OVERLAY TASK 9 WIRED, and the only one on this stage. Task 11a wired the other
            seven this wizard now offers, and `adjust-date-time` and `outside-window-warning` remain
            named in the Task 8 and 9 reports — but a control that WRITES with no confirmation step
            is not something to ship and fix later. `overlay-trigger.tsx` requires a commit handler
            at the type level precisely so a screen cannot open a decision surface it has not wired,
            and `{ kind: "unavailable" }` is how a screen says, in its own words, what cannot be done
            yet: the overlay opens and states the reason rather than leaving a dead button behind it.
          */}
          <WorkspaceOverlayTrigger
            overlayId="final-activation"
            facts={[
              { label: "Person", value: detail.patientName.trim() || "No name entered yet" },
              { label: "Pathway", value: pathwayVersionId ?? "No pathway chosen yet" },
              {
                label: "Sending times",
                value:
                  chosenPreference === null
                    ? "Not chosen yet"
                    : `${chosenPreference.label} — ${chosenPreference.sendTime}`,
              },
              ...(preview.kind === "ready"
                ? [{ label: "Messages", value: plannedScheduleSentence(preview.summary) }]
                : []),
            ]}
            commit={
              body === null || state.status === "sending"
                ? { kind: "unavailable", reason: unavailableReasonFor({ assurances, preview, state, patientDetail }) }
                : { kind: "record", record: onActivate }
            }
            className={primaryControlClass}
          >
            <ClipboardCheck aria-hidden="true" className="size-icon-md shrink-0" />
            <span className="truncate">Create and start this plan</span>
          </WorkspaceOverlayTrigger>
        </div>
      </div>
    </section>
  );
}

/**
 * Why the plan cannot be created right now, in the clinician's own terms.
 *
 * Rendered by the overlay itself, as the reason its decision control points at — so a coordinator
 * who opens the confirmation is told what is missing rather than finding a control that does
 * nothing.
 *
 * THE ORDER, AND WHAT IT ACTUALLY IS. A write in flight comes first, because it is not a missing
 * thing at all: while a create may already have happened, no sentence about a missing stage is safe
 * to print. Everything after it IS a missing thing, and those are ordered by the stage a coordinator
 * would go back to, earliest first, because the first sentence is the one that gets read.
 *
 * STAGE 1 WAS MISSING FROM THIS CHAIN. Until the confirmations were recorded, a half-ticked draft
 * changed nothing about the plan and could not block a create, so there was nothing here to say.
 * Task 9b made a create depend on them — and this function still consulted only the state, the
 * patient detail and the preview, so a restored half-ticked draft with detail present and a ready
 * schedule fell through to the catch-all: "The stages behind this one say which."
 *
 * WHY THE ASSURANCE BRANCH IS BELOW `sending` AND NOT ABOVE IT (fix round 3). It was above, on the
 * argument that the two cannot coexist: `activate` returns early on a null body, and the body is
 * null whenever a confirmation is missing, so a send cannot START with one outstanding. **That
 * proves entry into `sending`, not the state during it, and they are different claims.** The status
 * is component state while the draft is a separate external store, and nothing gates the review
 * stage's Back control, `update`, or `onAssuranceChange` on a send being in flight. So a coordinator
 * can go back mid-create, untick a box, and return — and the control would have said "Still to
 * confirm" on a screen where a plan may already exist. The status line above it says a create is
 * running, so the screen was not wholly wrong; the control was, at the one moment it matters most.
 *
 * WHAT THIS CHAIN DOES NOT COVER, stated because the paragraph above would otherwise imply it does.
 * Stage 2's pathway version and sending preference have no branch here: with either missing, the
 * body is null, none of the branches match, and the catch-all speaks — last, not in stage order. So
 * the ordering claim holds for the stages that ARE branched (stage 1 here, stage 3's patient detail,
 * then stage 4's own dates) and not for the chain as a whole. That gap predates this task and
 * closing it is separate work; it is named here rather than papered over by a comment that describes
 * a chain this function does not have.
 */
function unavailableReasonFor(input: {
  assurances: PlanDraftAssurances;
  preview: PlanSchedulePreview;
  state: PlanSubmissionState;
  patientDetail: ReturnType<typeof createPlanPatientDetail>;
}): string {
  if (input.state.status === "sending") {
    return "The plan is being created now. Nothing else can be confirmed until that finishes.";
  }
  if (!everyAssuranceConfirmed(input.assurances)) {
    return unconfirmedAssuranceSentence(input.assurances);
  }
  if (input.patientDetail === null) {
    return "The patient's name and mobile number are needed before a plan can be created. They are entered on the personalisation stage.";
  }
  if (input.preview.kind === "incomplete") {
    return input.preview.issues.map((issue) => issue.message).join(" ");
  }
  if (input.preview.kind === "refused") {
    return submissionRefusalWording(input.preview.refusal).because;
  }
  return "Something this plan needs has not been settled yet, so nothing can be created. The stages behind this one say which.";
}
