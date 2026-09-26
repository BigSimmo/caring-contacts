// tests/caring-contacts-plan-wizard.dom.test.tsx
//
// The activation wizard's shell and its first two stages (Phase 2B Task 7).
//
// This is where the stages themselves are proved. The browser suite
// (`tests/ui-caring-contacts-workspace.spec.ts`) cannot reach them: its isolated server seeds no
// referrals, so `/caring-contacts/plans/new` always renders the screen's own statement of what it
// needs, and a fabricated referral id in that spec would render the same screen while pretending
// to prove a stage. Here a referral can simply be supplied as a prop.
//
// What is pinned, and why each one:
//
//   * Ruling [112] — stage 1 separates what was READ from the referral from what the COORDINATOR
//     confirms, and labels each. The mockup blends them and sources a patient name and a mobile
//     number to "Imported referral record"; a `Referral` carries neither, so those rows cannot be
//     built and their absence is asserted rather than assumed.
//   * Ruling [113] — stage 2 states a pathway the referral already names as an existing decision
//     with its provenance, and says so again, differently, once the coordinator changes it.
//   * Ruling [110] — the draft survives a remount and is gone after Discard draft.
//   * Ruling 52 — stages 3 and 4 are unavailable controls with a stated reason, never dead ends.
import { readFileSync } from "node:fs";
import path from "node:path";

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

// The wizard navigates once, after a plan has been created and after the draft has been cleared.
// `useRouter` is the App Router hook a Client Component uses for that (Next 16); there is no router
// in jsdom, so the push is recorded instead and its ORDER against the clear is what Ruling [117] is
// about.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
}));

import {
  PLAN_DRAFT_STORAGE_KEY,
  clearPlanDraft,
  readPlanDraft,
  writePlanDraft,
} from "@/components/caring-contacts/workspace/plan-wizard/plan-draft";
import {
  WIZARD_DECISION_REFUSALS,
  WIZARD_DECISION_REFUSAL_OVERRIDES,
} from "@/components/caring-contacts/workspace/plan-wizard/overlay-guards";
import { WorkspaceOverlays } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { clearStagedWorkspaceOverlayCommit } from "@/components/caring-contacts/workspace/overlays/overlay-commits";
import { createPlanPatientDetail } from "@/components/caring-contacts/workspace/plan-wizard/patient-detail";
import {
  assertBuiltStageHasABody,
  PATHWAY_PROVENANCE_TESTID,
  PlanWizard,
  type PlanWizardProps,
} from "@/components/caring-contacts/workspace/plan-wizard/plan-wizard";
import { planWizardStageImplementation } from "@/components/caring-contacts/workspace/plan-wizard/stages";
import { CARING_CONTACTS_PLAN_QUERY_PARAM, CARING_CONTACTS_ROUTES, patientRoute } from "@/lib/caring-contacts-routes";
import { EXACT_PATIENT_VISIBLE_MESSAGE } from "@/lib/caring-contacts/message-copy";
import {
  firstContactDayBounds,
  FIRST_CONTACT_REASON_MAX_LENGTH,
  SENDING_PREFERENCE_OPTIONS,
} from "@/lib/caring-contacts/schedule";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "@/lib/caring-contacts/synthetic-contacts";

import { stripSourceComments } from "./helpers/strip-source-comments";

const REFERRAL = "SYN-REFERRAL-001";
const PATIENT = "SYN-PATIENT-001";
const TEAM = "SYN-TEAM-001";
const NAMED_PATHWAY = "SYN-PATHWAY-001";
const OTHER_PATHWAY = "SYN-PATHWAY-002";

/**
 * The reserved fictional patient mobiles, read from the sealed domain rather than written out.
 *
 * A literal here would be a second copy of `synthetic-contacts.ts`'s list, so a test asserting the
 * screen names "the reserved numbers" could go on passing after the reserved numbers changed.
 */
const FICTIONAL_PATIENT_MOBILES = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS;

function pathwayOption(id: string, provenanceNote: string | null = null) {
  return {
    id,
    cadenceLabels: ["Day 1", "Week 1", "Month 1"],
    approvedBy: ["the clinical programme lead", "the lived-experience representative"],
    // Null is the ordinary case: a version whose record claims nothing about its provenance gets no
    // extra line. Ruling [126] adds a line only where the record itself says the approvals are
    // invented -- see the two cases at the end of this file.
    provenanceNote,
    publishedAt: null,
  };
}

function wizardProps(overrides: Partial<PlanWizardProps> = {}): PlanWizardProps {
  return {
    referralId: REFERRAL,
    patientId: PATIENT,
    teamId: TEAM,
    actorId: "demo-coordinator",
    actorRoleLabels: ["coordinator"],
    referralPathwayVersionId: NAMED_PATHWAY,
    pathwayOptions: [pathwayOption(NAMED_PATHWAY), pathwayOption(OTHER_PATHWAY)],
    // Both resolved on the server in production, for the reason round 1 finding M-2 established:
    // a screen must never re-derive a rule a module owns, and resolving here keeps the domain
    // modules out of the client bundle.
    sendingPreferenceOptions: SENDING_PREFERENCE_OPTIONS,
    fictionalPatientMobileNumbers: FICTIONAL_PATIENT_MOBILES,
    // The sealed domain's own value, never a literal. A copy of the string here would let a case
    // asserting "the governed wording is on screen" go on passing after the governed wording
    // changed -- and it is changing: the owner has decided it gains a first-name slot.
    patientVisibleMessageSpecimen: EXACT_PATIENT_VISIBLE_MESSAGE,
    ...overrides,
  };
}

function renderWizard(overrides: Partial<PlanWizardProps> = {}) {
  const props = wizardProps(overrides);
  return { ...render(<PlanWizard {...props} />), props };
}

/** Ticks both stage-1 confirmations and moves to stage 2. */
async function reachPathwayStage(user: ReturnType<typeof userEvent.setup>) {
  for (const box of screen.getAllByRole("checkbox")) await user.click(box);
  await user.click(screen.getByRole("button", { name: /Continue to pathway/ }));
  return screen.getByRole("region", { name: "Pathway" });
}

/** Ticks the confirmations, chooses a pathway, and moves to stage 3. */
async function reachPersonalisationStage(user: ReturnType<typeof userEvent.setup>) {
  await reachPathwayStage(user);
  await user.click(screen.getByRole("radio", { name: new RegExp(NAMED_PATHWAY) }));
  await user.click(screen.getByRole("button", { name: /Continue to personalisation/ }));
  return screen.getByRole("region", { name: "Personalisation" });
}

/** Ticks the confirmations, chooses a pathway, fills stage 3, and moves to stage 4. */
async function reachReviewStage(user: ReturnType<typeof userEvent.setup>) {
  await reachPersonalisationStage(user);
  await user.type(screen.getByLabelText(/Patient.s name/i), "Rowan Example");
  await user.type(screen.getByLabelText(/What should we call them in messages/i), "Rowan");
  await typeMobileTwice(user, document.body, FICTIONAL_PATIENT_MOBILES[1]);
  await user.click(screen.getByRole("radio", { name: /Morning/ }));
  await user.click(screen.getByRole("button", { name: /^Continue to review/ }));
  return screen.getByRole("region", { name: "Review and activation" });
}

/**
 * Types the mobile number into both boxes and waits for the shared-number check to answer.
 *
 * The default `fetch` stub (see `beforeEach`) answers that no other patient has the number, so the
 * stage is released once the answer lands.
 */
async function typeMobileTwice(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, mobile: string) {
  await user.type(within(scope).getByLabelText(/Mobile number this plan will use/i), mobile);
  await user.type(within(scope).getByLabelText(/Type the mobile number again/i), mobile);
  await within(scope).findByText(/No other patient in your team's active plans has this mobile number/i);
}

/** The shared-number check's endpoint, answered by every stub in this file before anything else. */
const SHARED_MOBILE_PATH = "/api/caring-contacts/patients/shared-mobile";

function isSharedMobileCheck(input: unknown): boolean {
  return String(input instanceof Request ? input.url : input).endsWith(SHARED_MOBILE_PATH);
}

/** The discharge day every stage-4 case works from, and the days the schedule allows around it. */
const DISCHARGE_DAY = "2026-03-10";

function bounds() {
  const resolved = firstContactDayBounds(DISCHARGE_DAY);
  if (resolved === null) throw new Error("the fixture discharge day is not a calendar day");
  return resolved;
}

/** A stored draft filled in as far as the end of stage 3 and sitting on the review stage. */
function reviewReadyDraft(overrides: Record<string, unknown> = {}) {
  return {
    referralId: REFERRAL,
    stage: "review",
    assurances: { patientAgreed: true, mobileIsPatientControlled: true },
    pathwayVersionId: NAMED_PATHWAY,
    patientDetail: {
      patientName: "Rowan Example",
      preferredName: "Rowan",
      patientMobileNumber: FICTIONAL_PATIENT_MOBILES[1],
      patientIdentifiers: "SYN-MRN-4471",
      culturalIdentity: "",
    },
    sendingPreference: "morning",
    activation: { dischargeDay: DISCHARGE_DAY, firstContactDay: "", firstContactReason: "" },
    submission: null,
    ...overrides,
  };
}

/**
 * The wizard AND the overlay host, because stage 4's write goes through a confirmation overlay.
 *
 * `WorkspaceOverlays` is mounted by the shell in production and takes no props; rendering it beside
 * the wizard is what lets a case press the confirm control rather than reach past it and call the
 * commit directly. A test that called the commit itself would prove the write and not the
 * confirmation step, which is the half Ruling [117] is actually about.
 */
function renderWizardWithOverlays(overrides: Partial<PlanWizardProps> = {}) {
  // ONE render, not two. A second `render()` mounts a second container that `view.unmount()` on the
  // first does not remove, so a case that renders in a loop accumulates overlay hosts and the next
  // iteration finds two decision controls. Rendering both as one tree makes unmounting total.
  return render(
    <>
      <PlanWizard {...wizardProps(overrides)} />
      <WorkspaceOverlays />
    </>,
  );
}

/**
 * Stage 4's own trigger, NAMED BY ROW rather than as "the trigger on screen".
 *
 * Task 11a put `discard-changes` and `save-draft` in the draft notice, which every stage renders, so
 * a bare `getByTestId("workspace-overlay-trigger")` is ambiguous here. Taking the first match would
 * be worse than the ambiguity: it would silently confirm whichever row happened to render earliest,
 * and every stage-4 case would go on passing while proving a different decision.
 */
function finalActivationTrigger(): HTMLElement {
  const matches = screen
    .getAllByTestId("workspace-overlay-trigger")
    .filter((element) => element.getAttribute("data-overlay-trigger") === "final-activation");
  if (matches.length !== 1) {
    throw new Error(`expected exactly one final-activation trigger on screen, found ${matches.length}`);
  }
  return matches[0];
}

/** Opens the confirmation overlay from stage 4 and presses its own decision control. */
async function confirmActivation(user: ReturnType<typeof userEvent.setup>) {
  await user.click(finalActivationTrigger());
  const action = await screen.findByTestId("workspace-overlay-action");
  await user.click(action);
  return action;
}

/**
 * One `fetch` answer for the CREATE, and a successful start for the activate that follows it.
 *
 * Stage 4 performs two writes (Ruling [123]), so a stub answering one shape for both would make a
 * refused create look like a refused start. The cases about the second write stub it themselves.
 */
function stubFetch(answer: () => Promise<Response>) {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (input) =>
      isSharedMobileCheck(input)
        ? jsonResponse({ value: { sharedWith: 0 } })
        : String(input).endsWith("/api/caring-contacts/plans")
          ? answer()
          : jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "active", version: 2 } } }),
    );
}

/**
 * What a successful create answers with: the `PlanRecord` `writeHandler` wraps in `{ value }`.
 *
 * Named rather than written inline because the second write reads `plan.version` out of it, so
 * `{ value: null }` is not a stand-in for success any more -- it is a plan that exists and whose
 * version nothing can name, which is its own case below.
 */
function createdPlanAnswer(version = 1): Response {
  return jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version } } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  // Stage 4 refuses a discharge day in the future or more than 90 days before today. These cases use
  // a March 2026 discharge, so "today" is pinned two days after it. Only `Date` is faked, so
  // user-event and waitFor keep their real timers.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-03-12T04:00:00.000Z"));
  window.sessionStorage.clear();
  window.localStorage.clear();
  // The store holds module-level state that clearing storage by hand does not reach.
  clearPlanDraft();
  // The staged overlay commit lives in a module-scoped slot, so it outlives a render exactly as the
  // browser tab does. Emptying it is what stops one case's staged intent answering the next one's.
  clearStagedWorkspaceOverlayCommit();
  navigation.push.mockClear();
  // jsdom reports 1024px; the overlay host needs a width to choose a modality at all.
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  window.history.pushState(null, "", "/caring-contacts/plans/new");
  // The shared-number check runs once the mobile is typed twice. By default it answers that no other
  // patient has the number, and anything else a case did not stub fails the way an unreachable
  // service would. Cases about the check itself, and the write cases, replace this.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) =>
    isSharedMobileCheck(input)
      ? jsonResponse({ value: { sharedWith: 0 } })
      : Promise.reject(new TypeError("Failed to fetch")),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearPlanDraft();
  clearStagedWorkspaceOverlayCommit();
});

describe("the caring-contacts plan wizard — stage 1, agreement (Ruling [112])", () => {
  it("shows what the referral actually carries, separately from what the coordinator confirms", async () => {
    renderWizard();

    const read = screen.getByText("Read from the referral").closest("div");
    expect(read).not.toBeNull();
    expect(read!).toHaveTextContent(REFERRAL);
    expect(read!).toHaveTextContent(PATIENT);
    expect(read!).toHaveTextContent(TEAM);

    // The provenance is the point. A clinician's own tick presented as an imported record would be
    // lying about where a fact came from, on a screen whose whole purpose is assurance.
    const confirmed = screen.getByText("Confirmed by you").closest("div");
    expect(confirmed).not.toBeNull();
    expect(within(confirmed!).getAllByRole("checkbox")).toHaveLength(2);
    expect(confirmed!).toHaveTextContent(/not imported facts/i);
  });

  it("claims no patient name and no mobile number, because a referral holds neither", () => {
    const { container } = renderWizard();
    const text = container.textContent ?? "";

    // The mockup's `AgreementStage` renders `patient.fullName · patient.id` and a mobile-suitability
    // row, both sourced "Imported referral record". `Referral` in model.ts is five fields and none
    // of them is either, so no wording here may claim one was imported.
    expect(text).not.toMatch(/imported referral record/i);
    // The one place a mobile number is mentioned is a confirmation the coordinator makes, and it
    // says the number will be used, never that it was read from anywhere.
    expect(text).toMatch(/mobile number this plan will use is the patient’s own/i);
    expect(text).toMatch(/entered at personalisation/i);
  });

  it("says what the plan will record about the confirmations, and what it will not", async () => {
    // THIS SENTENCE HAS NOW BEEN WRONG IN TWO DIRECTIONS AND CORRECT IN A THIRD.
    //
    // Round 1, M-6: "Both confirmations are recorded for this sign-up", directly beneath a panel
    // saying nothing in this domain recorded them. Round 2, item 1: "Neither is stored anywhere",
    // on a screen whose own draft notice says the opposite — the more dangerous direction, because
    // a clinician on a shared ward computer reads it as a reason not to press Discard draft.
    //
    // Task 9b makes a third direction possible, and it is the one this case now guards hardest:
    // there IS a record on the plan, and it records that the COORDINATOR confirmed a check. It does
    // not record that the patient consented — agreement is held in the hospital record, not here —
    // so a screen saying the plan records the agreement would be claiming something the domain
    // cannot back, at the last moment before a plan is created.
    const user = userEvent.setup();
    const { container } = renderWizard();
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);

    const text = container.textContent ?? "";
    // Pinned as a whole sentence, not a loose match — round 2, item 1. The replacement for M-6's
    // wording was itself untrue in the other direction ("Neither is stored anywhere", on a screen
    // whose own draft notice says the opposite), and a looser assertion would not have caught it.
    expect(text).toContain(
      "Both confirmations are ticked, so a pathway can be chosen. Each is recorded on the plan when the plan is created \u2014 that you confirmed it, and when. Until then, like everything else on this screen, they are kept on this computer until you finish or discard.",
    );
    // The understating direction is still the more dangerous one on a shared ward computer: it
    // gives a clinician a reason NOT to press Discard draft while a patient's details sit in this
    // tab. Round 2's pin stays, because Task 9b did not make the ticks stop being held here.
    expect(text, "the screen denies keeping what it is in fact keeping").not.toMatch(/stored anywhere|kept anywhere/i);
    // THE OVERSHOOT, which is new and is what the record made possible. What is recorded is the
    // coordinator's confirmation, never the patient's consent.
    expect(text, "the screen claims the plan records the patient's consent").not.toMatch(
      /consent is recorded|records (?:the )?(?:patient(?:\u2019|')s )?consent/i,
    );
  });

  it("shows roles in plain words, never as the domain's identifiers", async () => {
    // Round 1, finding M-2. `plan-start-state.tsx`'s REFERRAL_STATE_LABELS is this workspace's own
    // pattern; camelCase identifiers on a clinical screen are not.
    const user = userEvent.setup();
    const { container } = renderWizard();
    expect(container.textContent ?? "").toMatch(/coordinator/);
    expect(container.textContent ?? "", "an identifier reached the screen").not.toMatch(
      /clinicalProgrammeLead|livedExperienceRepresentative|teamLead/,
    );

    await reachPathwayStage(user);
    const pathwayText = container.textContent ?? "";
    expect(pathwayText).toMatch(/Approved by the clinical programme lead and the lived-experience representative/);
    expect(pathwayText, "an identifier reached the pathway chooser").not.toMatch(
      /clinicalProgrammeLead|livedExperienceRepresentative/,
    );
  });

  it("says plainly what the plan records about the confirmations, and where agreement really lives", () => {
    renderWizard();
    const panel = screen.getByText("Confirmed by you").closest("div")!;
    // Task 7 found there was no field for either of these anywhere, and this case pinned the panel
    // saying so. Task 9b added one, so that sentence is now the false one and this is the pin that
    // stops it surviving.
    expect(panel).not.toHaveTextContent(/nothing in this domain records/i);
    // What the plan records is the coordinator's confirmation and the instant of it.
    expect(panel).toHaveTextContent(/what the plan records is that you confirmed each of these, and when/i);
    // And what it does NOT record: the patient's consent. Agreement is held in the hospital record,
    // which this system is not connected to, so a panel claiming otherwise would be asserting
    // something no read here could ever support.
    expect(panel).toHaveTextContent(/not that the patient consented/i);
    expect(panel).toHaveTextContent(/hospital record/i);
  });

  it("will not go to the pathway stage until both confirmations are ticked, and says why", async () => {
    const user = userEvent.setup();
    renderWizard();

    const forward = screen.getByRole("button", { name: /Continue to pathway/ });
    expect(forward, "the forward control was live with nothing confirmed").toBeDisabled();
    // A control awaiting validity is TRANSIENTLY inert, which is what native `disabled` is for —
    // and it is never combined with `aria-disabled`, which lint fails on as a pair.
    expect(forward).not.toHaveAttribute("aria-disabled");
    // `getByText`, not `getByRole("status")`: the draft notice owns a status region of its own, so
    // the role alone names two live regions on this screen.
    expect(screen.getByText(/cannot be chosen until both confirmations/i)).toBeInTheDocument();

    const [first, second] = screen.getAllByRole("checkbox");
    await user.click(first);
    expect(forward, "one confirmation was enough").toBeDisabled();

    await user.click(second);
    expect(forward).toBeEnabled();
  });
});

describe("the caring-contacts plan wizard — stage 2, pathway (Ruling [113])", () => {
  it("states the pathway the referral already names as an existing decision, with its provenance", async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachPathwayStage(user);

    const decision = screen.getByRole("group", { name: "Already decided when the referral was accepted" });
    expect(decision).toHaveTextContent(NAMED_PATHWAY);
    expect(decision, "the existing decision does not say where it came from").toHaveTextContent(
      /travels on the referral record/i,
    );
    expect(decision).toHaveTextContent(/changes what was decided when the referral was accepted/i);

    // The referral's own pathway is what the choice starts on, not an empty selection.
    expect(screen.getByRole("radio", { name: new RegExp(NAMED_PATHWAY) })).toBeChecked();
  });

  it("reads as changing an earlier decision once the coordinator picks something else", async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachPathwayStage(user);

    await user.click(screen.getByRole("radio", { name: new RegExp(OTHER_PATHWAY) }));

    const changed = screen.getByRole("group", { name: "You are changing an earlier decision" });
    expect(changed).toHaveTextContent(NAMED_PATHWAY);
    expect(changed).toHaveTextContent(/returns to what was decided when the referral was accepted/i);
  });

  it("is an ordinary first choice when the referral names no pathway", async () => {
    const user = userEvent.setup();
    renderWizard({ referralPathwayVersionId: null });
    const panel = await reachPathwayStage(user);

    // Nothing had been decided, so nothing is stated about a decision that was never made.
    //
    // Asserted as a COUNT of what the panel contains, not as the absence of two known headings.
    // Round 2: the two `queryByRole` lines below could not fail. Dropping the `=== null` guard in
    // the component does not render either of those panels -- it renders the OTHER branch, the
    // "cannot be used" panel, reading "Accepting this referral named null ...". Its accessible name
    // matches neither regex, so the case passed against a screen that had grown a panel stating a
    // decision about a referral that named nothing. The chooser's own fieldset is the one group
    // this stage is entitled to, so counting is what actually pins the branch.
    const groups = within(panel).getAllByRole("group");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveAccessibleName("Choose a governed pathway version");

    expect(screen.queryByRole("group", { name: /decided when the referral was accepted/i })).toBeNull();
    expect(screen.queryByRole("group", { name: /changing an earlier decision/i })).toBeNull();
    for (const radio of screen.getAllByRole("radio")) expect(radio).not.toBeChecked();
  });

  it("says so when the referral names a pathway that cannot be started on now", async () => {
    const user = userEvent.setup();
    // A referral accepted against a version that has since been retired, or one still in review:
    // the id is on the referral, and the version is not among the approved options.
    renderWizard({ pathwayOptions: [pathwayOption(OTHER_PATHWAY)] });
    await reachPathwayStage(user);

    const blocked = screen.getByRole("group", { name: "The pathway named on the referral cannot be used" });
    expect(blocked).toHaveTextContent(NAMED_PATHWAY);
    expect(blocked).toHaveTextContent(/retired/i);
  });

  it("states an empty chooser as a governance fact, not as a screen with nothing on it", async () => {
    const user = userEvent.setup();
    renderWizard({ pathwayOptions: [], referralPathwayVersionId: null });
    await reachPathwayStage(user);

    expect(screen.getByRole("group", { name: "No approved pathway yet" })).toHaveTextContent(
      /two different people have approved/i,
    );
  });
});

describe("the caring-contacts plan wizard — the draft (Ruling [110])", () => {
  it("keeps what has been entered so a reload does not lose it", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWizard();
    await reachPathwayStage(user);
    await user.click(screen.getByRole("radio", { name: new RegExp(OTHER_PATHWAY) }));

    expect(readPlanDraft(REFERRAL)).toEqual({
      referralId: REFERRAL,
      stage: "pathway",
      assurances: { patientAgreed: true, mobileIsPatientControlled: true },
      pathwayVersionId: OTHER_PATHWAY,
      // Stage 3's fields are present and empty from the first render: nothing in this domain holds
      // a patient's name, mobile number or sending preference, so there is nothing to prefill.
      patientDetail: {
        patientName: "",
        preferredName: "",
        patientMobileNumber: "",
        patientIdentifiers: "",
        culturalIdentity: "",
      },
      sendingPreference: null,
      // Stage 4's are present and empty for the same reason, and no plan identifier has been minted:
      // Ruling [120] mints at the moment stage 4 is REACHED, so a sign-up abandoned before it never
      // mints one at all.
      activation: { dischargeDay: "", firstContactDay: "", firstContactReason: "" },
      submission: null,
      // Task 11a's two wizard-local confirmations, present and false from the first render for the
      // same reason as the fields above: nothing has recorded either yet. Written out rather than
      // read from `NO_PLAN_DRAFT_DECISIONS`, so this cannot agree with the module by construction.
      decisions: { identityChecked: false, preferenceGivenOnStaffedLine: false },
      // #M6P1QQ: one `writePlanDraft` per step this flow has taken so far -- `reachPathwayStage`'s
      // own stage transitions plus the pathway radio click above -- each bumping the version by one
      // from the fresh draft's 0. Not asserted as an interesting fact in its own right; asserted
      // because `toEqual` checks every field, and a wrong count here would mean a write this flow
      // made went missing or an extra one snuck in.
      version: 4,
    });

    // A remount is what a page refresh looks like from this component's point of view.
    unmount();
    renderWizard();
    expect(await screen.findByRole("region", { name: "Pathway" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: new RegExp(OTHER_PATHWAY) })).toBeChecked();
  });

  it("removes everything when the draft is discarded, and says it did", async () => {
    const user = userEvent.setup();
    // WITH THE OVERLAY HOST, because Task 11a put `discard-changes` in front of this. The control
    // now RAISES the frozen confirmation and the confirmation is what discards, so a case that
    // pressed the control alone would prove a history entry rather than a discard.
    renderWizardWithOverlays();
    await reachPathwayStage(user);
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: /Discard draft/ }));
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    expect(
      window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY),
      "the discarded draft was left on the machine",
    ).toBeNull();
    // Back to the first stage with nothing ticked: a discard that left the answers on screen would
    // put them back into storage on the next keystroke.
    expect(screen.getByRole("region", { name: "Agreement" })).toBeInTheDocument();
    for (const box of screen.getAllByRole("checkbox")) expect(box).not.toBeChecked();
    expect(screen.getByText(/The draft was discarded/)).toBeInTheDocument();
  });

  it("still lets a clinician work when the browser refuses to keep it, and says it is not being kept", async () => {
    // Round 1, finding I-1. Safari private browsing hands out a real `sessionStorage` whose
    // `setItem` throws, and the screen must keep working: a coordinator who cannot tick a box has
    // no way to sign a patient up at all. `Storage.prototype`, not the instance — jsdom's storage
    // is a Proxy that answers from the prototype, so an instance spy is never consulted.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    const user = userEvent.setup();
    renderWizard();

    const [first] = screen.getAllByRole("checkbox");
    await user.click(first);

    expect(setItem, "the refusal was never actually exercised").toHaveBeenCalled();
    expect(first, "the screen did not change when the browser refused the write").toBeChecked();
    // And the notice tells the truth about it rather than promising a memory the browser refused.
    expect(screen.getByRole("group", { name: /Nothing is being kept on this computer/ })).toHaveTextContent(
      /finish this sign-up in one sitting/i,
    );
  });

  it("states in place what is being kept, and what would remove it", () => {
    renderWizard();
    // Spec §4.4: the system is doing something the clinician did not ask for, so the surface says
    // why and what changes it, in words, on the page — not in a tooltip.
    const notice = screen.getByRole("group", { name: /Kept on this computer until you close the tab/ });
    expect(notice).toHaveTextContent(/Why:/);
    expect(notice).toHaveTextContent(/What changes it:/);
    expect(notice).toHaveTextContent(/Closing this tab removes it/);
    expect(notice).toHaveTextContent(/Discard draft/);

    // ROUND 1, ITEM 5. The notice was written when the draft held two checkboxes, and said "what you
    // enter here" — true, and useless for judging the risk once stage 3 puts a patient's NAME and
    // MOBILE NUMBER in that storage. Ruling [110] exists for exactly this sentence, so it names what
    // it holds rather than leaving a clinician to infer it.
    expect(notice, "the notice does not say what it is holding").toHaveTextContent(/name and mobile number/i);
  });
});

describe("the caring-contacts plan wizard — every activation surface is a production tap target", () => {
  /**
   * `min-h-tap` is `--spacing-tap`, 3rem, 48px — this repo's production floor, which exceeds even
   * the AAA-level 44px criterion. Never `min-h-11`: 44px reintroduces a known `ui-smoke` sub-pixel
   * flake, and generic checklist guidance that says otherwise loses to the repo (AGENTS.md,
   * "External skill precedence").
   *
   * WHAT THIS PROVES AND WHAT IT CANNOT. jsdom has no layout, so this reads the class rather than
   * the rendered box — the same technique `tests/caring-contacts-overlay-trigger.dom.test.tsx`
   * already uses. A real pixel measurement belongs in the browser suite, and cannot be written
   * today: that server seeds no referral, so no Playwright case can reach a stage. Named in the
   * Task 7 report as a coverage gap rather than passed off as measured.
   *
   * It reads the ELEMENT A TAP ACTIVATES, which is the whole of round 1 finding I-2: the pathway
   * rows had `min-h-tap` on a wrapping `<div>` while the only activation surface was a 20px radio
   * and a one-line label, so the row looked tappable and mostly was not.
   */
  function activationSurfaces(container: HTMLElement): HTMLElement[] {
    // Every control a finger can land on: the buttons, and the labels that carry a checkbox or a
    // radio. Not the inputs themselves — a 20px input inside a 48px label is correct.
    return [
      ...container.querySelectorAll<HTMLElement>("button"),
      ...[...container.querySelectorAll<HTMLElement>("label")].filter(
        (label) => label.querySelector("input") !== null || label.getAttribute("for") !== null,
      ),
    ];
  }

  it("puts the tap floor on stage 1's confirmations and its controls", () => {
    const { container } = renderWizard();
    const surfaces = activationSurfaces(container);
    expect(surfaces.length, "no activation surfaces were found — update this test").toBeGreaterThan(0);
    for (const surface of surfaces) {
      expect(surface.className, `${surface.textContent?.trim()} is not a production tap target`).toContain("min-h-tap");
      expect(surface.className, `${surface.textContent?.trim()} was narrowed to the 44px guidance`).not.toContain(
        "min-h-11",
      );
    }
  });

  it("puts the tap floor on the pathway rows a finger actually lands on", async () => {
    const user = userEvent.setup();
    const { container } = renderWizard();
    await reachPathwayStage(user);

    const radios = [...container.querySelectorAll<HTMLInputElement>("input[type='radio']")];
    expect(radios.length, "the pathway chooser rendered no options — update this test").toBeGreaterThan(0);
    for (const radio of radios) {
      const label = container.querySelector<HTMLElement>(`label[for="${radio.id}"]`);
      expect(label, `the radio ${radio.id} has no label to tap`).not.toBeNull();
      expect(label!.className, `${radio.id}'s row is not a production tap target`).toContain("min-h-tap");
      expect(label!.className).not.toContain("min-h-11");
      // And the label is what the tap activates, rather than a 48px wrapper around a 20px input.
      expect(label!.contains(radio), `${radio.id} is outside the surface that carries the tap floor`).toBe(true);
    }

    for (const surface of activationSurfaces(container)) {
      expect(surface.className, `${surface.textContent?.trim()} is not a production tap target`).toContain("min-h-tap");
    }
  });
});

describe("the caring-contacts plan wizard — the stages Tasks 8 and 9 build", () => {
  it("names every stage, and marks the unbuilt ones as unbuilt", () => {
    renderWizard();
    const stepper = screen.getByRole("navigation", { name: "Sign-up stages" });
    for (const label of ["Agreement", "Pathway", "Personalisation", "Review and activation"]) {
      expect(within(stepper).getByText(label)).toBeInTheDocument();
    }
    // None. Task 9 built review and activation, which was the last one.
    expect(within(stepper).queryAllByText("not built yet")).toHaveLength(0);
  });

  it("offers a real Continue to review and activation, and the way back is a real control", async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachPersonalisationStage(user);

    // Task 9 flipped the table entry and wrote the body; this control followed with no edit at its
    // call site, which is what the extension point was for. It is a NATIVE `disabled` when stage 3
    // is incomplete -- transient inertness -- and never `aria-disabled`, which is for a destination
    // that will not exist however long you wait.
    const forward = screen.getByRole("button", { name: /^Continue to review/ });
    expect(forward).not.toHaveAttribute("aria-disabled");

    // And the way back from stage 3 is a real control.
    await user.click(screen.getByRole("button", { name: /Back to pathway/ }));
    expect(screen.getByRole("region", { name: "Pathway" })).toBeInTheDocument();
  });

  it("keeps the stage table and the wizard's own bodies in step", () => {
    // The extension point Tasks 8 and 9 change. `stages.ts`'s `never` default catches a stage added
    // to the union and left unclassified; this catches the opposite mistake, which is the one those
    // tasks can actually make — flipping an entry to `built` and not writing the body.
    expect(planWizardStageImplementation("agreement")).toEqual({ kind: "built" });
    expect(planWizardStageImplementation("pathway")).toEqual({ kind: "built" });
    expect(planWizardStageImplementation("personalisation")).toEqual({ kind: "built" });
    expect(planWizardStageImplementation("review")).toEqual({ kind: "built" });
  });

  it("fails loudly when a stage is marked built and no body was written for it", () => {
    // `stages.ts` has claimed since Task 7 that this file proves `assertBuiltStageHasABody` fires.
    // NOTHING DID. It was a description of a mechanism nobody had run, written as coverage, in the
    // one guard protecting the mistake each of Tasks 8 and 9 could actually make -- and by Task 9
    // every stage is built, so no render reaches the not-built branch at all and the claim could
    // never have been checked by accident either. Proved directly now, which is why the function is
    // exported.
    expect(() => assertBuiltStageHasABody(null, "review")).toThrow(
      /is marked built but this component renders no body/,
    );
    // And it is not a throw-for-everything: a body that exists passes straight through.
    expect(assertBuiltStageHasABody("a body", "review")).toBe("a body");
  });

  it("requires the activation stage to clear the draft, now that it is built", () => {
    // Round 1, finding M-1. The draft suite's "clears on successful activation" case calls
    // `clearPlanDraft()` directly, so it proves the seam works and nothing about whether Task 9
    // uses it. THIS is the case that arms itself: it does nothing while the review stage is
    // unbuilt, and becomes a real requirement the moment `stages.ts` says it is built.
    //
    // Comments are stripped first, for the reason `tests/route-reachability.test.ts` records:
    // documenting a rule is not obeying it, and a check that reads prose can be satisfied by a note
    // saying the call ought to be there.
    const wizardSource = stripSourceComments(
      readFileSync(
        path.join(process.cwd(), "src", "components", "caring-contacts", "workspace", "plan-wizard", "plan-wizard.tsx"),
        "utf8",
      ),
    );

    if (planWizardStageImplementation("review").kind === "not-built") {
      // Nothing to require yet, and this states that rather than passing silently: a review body
      // rendered while the table still calls the stage unbuilt would be its own defect.
      expect(wizardSource, "a review stage body appeared while the table still calls it unbuilt").not.toMatch(
        /case "review":\s*return \(/,
      );
      return;
    }

    // Task 9 has built it. The wizard now calls `clearPlanDraft()` once for the discard control, so
    // an activation that clears the draft is a SECOND call. A refactor that shares one call site
    // between the two would go red here — a false alarm a human reads, which is the safe direction
    // for a guard about a patient's details left on a ward machine.
    const clearCalls = [...wizardSource.matchAll(/clearPlanDraft\(\)/g)].length;
    expect(
      clearCalls,
      "the review stage is built but the wizard still clears the draft in only one place — a plan " +
        "activated without clearing leaves the patient's name and mobile number in this tab's storage",
    ).toBeGreaterThan(1);
  });

  it("returns a stored draft to the stage it names, including the one that writes", async () => {
    // This case used to prove the UNBUILT-stage panel, which was the only thing a stored draft
    // naming `review` could reach. Task 9 built that stage, so what a stored draft naming it now
    // proves is the thing worth proving: a clinician who reloads on the last screen before the plan
    // exists comes back to it rather than to the start of the sign-up.
    //
    // `UnbuiltStagePanel` and `ForwardControl`'s unavailable branch are now unreachable: every
    // member of the stage union is built. They are kept as the extension point for a fifth stage
    // and are unreached rather than dead, which is stated where they live -- see the Task 9 report.
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();

    const region = await screen.findByRole("region", { name: "Review and activation" });
    expect(within(region).getByRole("button", { name: /Back to personalisation/ })).toBeInTheDocument();
  });
});

describe("the caring-contacts plan wizard — stage 3, personalisation (Ruling [114])", () => {
  it("asks the clinician to TYPE the patient's name and mobile number, and ticks nothing", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    // The approved mockup renders four read-only rows with green ticks, sourced "Imported from the
    // synthetic referral". A `Referral` is five fields and holds neither a name nor a number
    // (Ruling [112]), so there is nothing to import and nothing to tick — presenting a clinician's
    // own typing as an imported governed value would be a lie about provenance on the screen that
    // decides where messages physically go.
    expect(within(stage).getByLabelText(/patient.s name/i)).toHaveValue("");
    expect(within(stage).getByLabelText(/Mobile number this plan will use/i)).toHaveValue("");
    expect(stage.textContent ?? "").not.toMatch(/imported from the synthetic referral/i);
    expect(stage.textContent ?? "").not.toMatch(/governed value present/i);
  });

  it("keeps what was typed in the draft, so a reload does not lose a patient's details", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWizard();
    await reachPersonalisationStage(user);

    await user.type(screen.getByLabelText(/patient.s name/i), "Rowan Example");
    await user.type(screen.getByLabelText(/Mobile number this plan will use/i), FICTIONAL_PATIENT_MOBILES[1]);

    const draft = readPlanDraft(REFERRAL);
    expect(draft?.patientDetail.patientName).toBe("Rowan Example");
    expect(draft?.patientDetail.patientMobileNumber).toBe(FICTIONAL_PATIENT_MOBILES[1]);

    // A remount is what a page refresh looks like from this component's point of view.
    unmount();
    renderWizard();
    expect(await screen.findByRole("region", { name: "Personalisation" })).toBeInTheDocument();
    expect(screen.getByLabelText(/patient.s name/i)).toHaveValue("Rowan Example");
    expect(screen.getByLabelText(/Mobile number this plan will use/i)).toHaveValue(FICTIONAL_PATIENT_MOBILES[1]);
  });

  it("says what is still missing, in words, tied to the control it is about", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    const name = within(stage).getByLabelText(/patient.s name/i);
    const mobile = within(stage).getByLabelText(/Mobile number this plan will use/i);
    for (const field of [name, mobile]) {
      const described = (field.getAttribute("aria-describedby") ?? "")
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join(" ");
      expect(described, "a required field states nothing about what is missing").toMatch(/cannot be created without/i);
      expect(field).toHaveAttribute("aria-invalid", "true");
    }

    await user.type(name, "Rowan Example");
    expect(within(stage).getByLabelText(/patient.s name/i)).toHaveAttribute("aria-invalid", "false");
  });
});

describe("stage 3 — the message's name is asked for, never split off the stored one", () => {
  // Owner decision, 2026-08-26. The design shows this value arriving from the hospital record; it is
  // typed here instead, and it is its own question rather than a derivation, because splitting one
  // free-text name greets a one-name person by their only name, a family-name-first entry by its
  // surname, and `Mr John Smith` as "Mr".

  it("offers its own field, and prefills nothing from the name above", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    const name = within(stage).getByLabelText(/patient.s name/i);
    const preferred = within(stage).getByLabelText(/what should we call them in messages/i);
    expect(preferred).toHaveValue("");

    // THE LOAD-BEARING MOMENT: typing a titled, family-name-first name into the field above must
    // leave this one alone. A prefill would put "Mr" into a suicide-prevention message and a
    // clinician who trusted the screen would never see it happen.
    await user.type(name, "Mr John Smith");
    expect(
      within(stage).getByLabelText(/what should we call them in messages/i),
      "the preferred name was derived from the patient's name",
    ).toHaveValue("");
  });

  it("blocks Continue until it is answered, and says why in words", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    await user.type(within(stage).getByLabelText(/patient.s name/i), "Rowan Example");
    await typeMobileTwice(user, stage, FICTIONAL_PATIENT_MOBILES[1]);
    await user.click(within(stage).getByRole("radio", { name: /Morning/ }));

    const preferred = within(stage).getByLabelText(/what should we call them in messages/i);
    expect(preferred).toHaveAttribute("aria-invalid", "true");
    const described = (preferred.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toMatch(/asked for rather than taken from the name above/i);
    expect(within(stage).getByRole("button", { name: /^Continue to review/ })).toBeDisabled();

    // Positive control: answering it is what releases the stage, so the block above is this field
    // rather than one of the other three still being empty.
    await user.type(preferred, "Rowan");
    expect(within(stage).getByLabelText(/what should we call them in messages/i)).toHaveAttribute(
      "aria-invalid",
      "false",
    );
    expect(within(stage).getByRole("button", { name: /^Continue to review/ })).toBeEnabled();
  });

  it("reads it back on the review stage as entered rather than as imported", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachReviewStage(user);

    expect(stage).toHaveTextContent(/Called this in messages/i);
    expect(stage).toHaveTextContent(/from what the person asked to be called/i);
    expect(stage).toHaveTextContent(/Never taken from the name above/i);
  });
});

describe("stage 3 — the mobile number is required and nothing here connects (Ruling [115])", () => {
  it("states, where the number is entered, that nothing is ever sent to it", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    // "A clinician who believes this field reaches a real handset is the single most dangerous
    // misunderstanding this interface can create." The statement is in the flow of the page, in the
    // shape spec §4.4 sets, beside the field it is about — never a `title` attribute.
    const group = within(stage).getByRole("group", { name: /is ever sent to any number/i });
    expect(group).toHaveTextContent(/Why:/);
    expect(group).toHaveTextContent(/What changes it:/);
    // The reserved fictional numbers come from `synthetic-contacts.ts`, not from a literal here.
    for (const reserved of FICTIONAL_PATIENT_MOBILES) {
      expect(group).toHaveTextContent(reserved);
    }
  });

  it("keeps the caution's live region on the page from the start, so it can be announced (I-2)", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    const mobile = within(stage).getByLabelText(/Mobile number this plan will use/i);

    // ROUND 1, I-2. The caution used to be an entire `<p role="status">` CREATED when the condition
    // became true. A live region inserted along with its content is unreliably announced — the
    // region has to be on the page already for a content change to be spoken. That made the one
    // string telling a clinician their number is not a reserved fictional one the single string on
    // this screen a screen-reader user might never hear, on the field that decides where a message
    // physically goes. A caution nobody hears is not a caution.
    const caution = within(stage).getByTestId("caring-contacts-patient-mobile-caution");
    expect(caution).toHaveAttribute("role", "status");
    // `toBeEmptyDOMElement`, not `toHaveTextContent("")`. The reviewer checked the matcher source and
    // the latter IS behaviourally correct here — `checkingWithEmptyString` makes it pass only on a
    // genuinely empty element — but the message it prints on failure reads "Checking with empty
    // string will always match, use `.toBeEmptyDOMElement()`", which would tell a future reader this
    // assertion is vacuous when it is not. A true assertion with a lying failure message is worse
    // than it looks: the reader who acts on that message deletes a real check (round 2, item 3).
    expect(caution).toBeEmptyDOMElement();

    await user.type(mobile, "+61 400 000 000");
    expect(caution).toHaveTextContent(/not one of the reserved fictional numbers/i);

    // And it is reachable from the input itself, not only as a region a reader has to find.
    expect(mobile.getAttribute("aria-describedby") ?? "").toContain(caution.id);
    expect(caution.id).not.toBe("");
  });

  it("says when the number typed is not one of the reserved fictional ones, and still accepts it", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    const mobile = within(stage).getByLabelText(/Mobile number this plan will use/i);

    await user.type(mobile, "+61 400 000 000");
    expect(stage.textContent ?? "").toMatch(/not one of the reserved fictional numbers/i);
    // A STATEMENT, not a refusal: the number is a valid Australian mobile, so it is accepted, and
    // the screen says it is not one of the reserved fictional ones.
    expect(mobile).toHaveAttribute("aria-invalid", "false");

    await user.clear(mobile);
    await user.type(mobile, FICTIONAL_PATIENT_MOBILES[0]);
    expect(stage.textContent ?? "").not.toMatch(/not one of the reserved fictional numbers/i);
  });

  it("refuses a number intake would refuse: too short, or a landline", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    const mobile = within(stage).getByLabelText(/Mobile number this plan will use/i);

    await user.type(mobile, "123");
    expect(stage.textContent ?? "").toMatch(/Enter an Australian mobile number/);
    expect(stage.textContent ?? "").not.toMatch(/holds no rule/);

    await user.clear(mobile);
    await user.type(mobile, "0892223333");
    expect(stage.textContent ?? "").toMatch(/looks like a landline/);
  });
});

describe("stage 3 — the mobile number is typed twice and checked against the team's other plans", () => {
  /** Everything on stage 3 except the second entry of the mobile number. */
  async function fillAllButTheSecondEntry(user: ReturnType<typeof userEvent.setup>, stage: HTMLElement) {
    await user.type(within(stage).getByLabelText(/patient.s name/i), "Rowan Example");
    await user.type(within(stage).getByLabelText(/what should we call them in messages/i), "Rowan");
    await user.type(within(stage).getByLabelText(/Mobile number this plan will use/i), "0491 570 156");
    await user.click(within(stage).getByRole("radio", { name: /Morning/ }));
  }

  function forward(stage: HTMLElement) {
    return within(stage).getByRole("button", { name: /^Continue to review/ });
  }

  it("blocks Continue until the number is typed again, and says why beside the box", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);

    const again = within(stage).getByLabelText(/Type the mobile number again/i);
    expect(again).toHaveAttribute("aria-invalid", "true");
    const described = (again.getAttribute("aria-describedby") ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ");
    expect(described).toMatch(/Type the mobile number again/i);
    expect(forward(stage)).toBeDisabled();
    expect(stage.textContent ?? "").toMatch(/Before this plan can be reviewed:.*Type the mobile number again/);
  });

  it("refuses a second entry that differs by one digit, and names the mismatch", async () => {
    const user = userEvent.setup();
    const fetched = vi.mocked(globalThis.fetch);
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);

    const again = within(stage).getByLabelText(/Type the mobile number again/i);
    await user.type(again, "0491 570 165");
    expect(again).toHaveAttribute("aria-invalid", "true");
    expect(stage.textContent ?? "").toMatch(/The two mobile numbers do not match/);
    expect(forward(stage)).toBeDisabled();
    // Nothing is asked of the service about a number the two entries disagree on.
    expect(fetched.mock.calls.some(([input]) => isSharedMobileCheck(input))).toBe(false);
  });

  it("accepts the same number written +61 in one box and 0 in the other, including when pasted", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);

    const again = within(stage).getByLabelText(/Type the mobile number again/i);
    // Pasting is not blocked: the box compares, it does not fight the clipboard.
    await user.click(again);
    await user.paste("+61491570156");
    expect(again).toHaveValue("+61491570156");
    expect(again).toHaveAttribute("aria-invalid", "false");
    expect(stage.textContent ?? "").not.toMatch(/do not match/);
    await within(stage).findByText(/No other patient in your team's active plans has this mobile number/i);
    expect(forward(stage)).toBeEnabled();
  });

  it("asks the service once the entries match, with the number in the body and never the URL", async () => {
    const user = userEvent.setup();
    const fetched = vi.mocked(globalThis.fetch);
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);
    await typeSecondEntry(user, stage, "0491570156");
    await within(stage).findByText(/No other patient/i);

    const calls = fetched.mock.calls.filter(([input]) => isSharedMobileCheck(input));
    expect(calls).toHaveLength(1);
    const [input, init] = calls[0];
    expect(String(input)).toBe(SHARED_MOBILE_PATH);
    expect(String(input)).not.toMatch(/491/);
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ mobile: "+61491570156" });
  });

  it("warns when another patient has the number, and holds Continue until the tick", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) =>
      isSharedMobileCheck(input)
        ? jsonResponse({ value: { sharedWith: 1 } })
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);
    await typeSecondEntry(user, stage, "0491 570 156");

    expect(
      await within(stage).findByText(
        "Another patient in your team's active plans has this mobile number. Check it with the patient before continuing.",
      ),
    ).toBeInTheDocument();
    expect(forward(stage)).toBeDisabled();

    const tick = within(stage).getByRole("checkbox", { name: "I have checked this number is right" });
    await user.click(tick);
    expect(forward(stage)).toBeEnabled();

    // A changed number does not inherit the tick given to the previous one.
    const first = within(stage).getByLabelText(/Mobile number this plan will use/i);
    const again = within(stage).getByLabelText(/Type the mobile number again/i);
    await user.clear(first);
    await user.type(first, "0491 570 006");
    await user.clear(again);
    await user.type(again, "0491 570 006");
    await within(stage).findByText(/Another patient in your team's active plans has this mobile number/);
    expect(within(stage).getByRole("checkbox", { name: "I have checked this number is right" })).not.toBeChecked();
    expect(forward(stage)).toBeDisabled();
  });

  it("says the check could not run when it fails, and still requires the tick", async () => {
    const user = userEvent.setup();
    vi.mocked(globalThis.fetch).mockImplementation(async (input) =>
      isSharedMobileCheck(input)
        ? jsonResponse({ refusal: "access-audit-unavailable" }, 503)
        : Promise.reject(new TypeError("Failed to fetch")),
    );
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);
    await typeSecondEntry(user, stage, "0491 570 156");

    expect(await within(stage).findByText(/could not run/)).toBeInTheDocument();
    expect(stage.textContent ?? "").not.toMatch(/No other patient/);
    expect(forward(stage)).toBeDisabled();
    await user.click(within(stage).getByRole("checkbox", { name: "I have checked this number is right" }));
    expect(forward(stage)).toBeEnabled();
  });

  it("never writes the second entry into the draft, so a refresh asks for it again", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWizard();
    const stage = await reachPersonalisationStage(user);
    await fillAllButTheSecondEntry(user, stage);
    await typeSecondEntry(user, stage, "0491 570 156");
    await within(stage).findByText(/No other patient/i);

    const stored = window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY) ?? "";
    expect(stored).toContain("0491 570 156");
    expect(stored.split("0491 570 156")).toHaveLength(2);

    unmount();
    renderWizard();
    const again = await screen.findByLabelText(/Type the mobile number again/i);
    expect(again).toHaveValue("");
    expect(screen.getByRole("button", { name: /^Continue to review/ })).toBeDisabled();
  });

  it("asks for the second entry even when the number was filled in from intake", async () => {
    const user = userEvent.setup();
    renderWizard({
      intakePrefill: {
        patientIdentifier: "UR-00219384",
        givenName: "Rowan",
        familyName: "Example",
        mobileNumber: FICTIONAL_PATIENT_MOBILES[1],
        dischargeDate: "2026-03-10T12:00:00+08:00",
        hospitalFacility: "Royal Perth Hospital",
        cohort: "adult_crisis",
        admittingWard: "",
        clinicalSummary: "",
        safetyAlerts: [],
      } as NonNullable<PlanWizardProps["intakePrefill"]>,
    });
    const stage = await reachPersonalisationStage(user);
    expect(within(stage).getByLabelText(/Mobile number this plan will use/i)).toHaveValue(FICTIONAL_PATIENT_MOBILES[1]);
    expect(within(stage).getByLabelText(/Type the mobile number again/i)).toHaveValue("");
  });
});

/** Types the second entry only. */
async function typeSecondEntry(user: ReturnType<typeof userEvent.setup>, scope: HTMLElement, mobile: string) {
  await user.type(within(scope).getByLabelText(/Type the mobile number again/i), mobile);
}

describe("provenance when the referral was saved with an intake name and mobile", () => {
  const INTAKE = {
    patientIdentifier: "UR-00219384",
    givenName: "Rowan",
    familyName: "Example",
    mobileNumber: FICTIONAL_PATIENT_MOBILES[1],
    dischargeDate: "2026-03-10T12:00:00+08:00",
    hospitalFacility: "Royal Perth Hospital",
    cohort: "adult_crisis",
    admittingWard: "",
    clinicalSummary: "",
    safetyAlerts: [],
  };

  it("says the details were carried over from intake, never that a referral holds none", async () => {
    const user = userEvent.setup();
    const { container } = renderWizard({ intakePrefill: INTAKE });
    expect(container.textContent ?? "").toMatch(/recorded at intake are carried into personalisation/);
    expect(container.textContent ?? "").not.toMatch(/saved without a name or mobile number/);

    const stage = await reachPersonalisationStage(user);
    expect(stage.textContent ?? "").toMatch(/Check the person’s details/);
    expect(stage.textContent ?? "").not.toMatch(/nothing here was read from a record/);
    expect(within(stage).getByLabelText(/Patient.s name/i)).toHaveValue("Rowan Example");
    // What to call them is ASKED, never taken from the given name on the record.
    expect(within(stage).getByLabelText(/What should we call them in messages/i)).toHaveValue("");
  });
});

describe("stage 3 — cultural identity is NOT asked for (owner decision, round 1)", () => {
  it("offers no input for it", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    // The owner decided on 2026-08-25 to stop collecting it. Spec §2.5 records the status as
    // IMPORTED from the source record for aggregate reach reporting only; there is no source record
    // and no import, so what shipped was a clinician typing free text — and free text cannot carry
    // the small-cell suppression that reporting depends on, because either every rare spelling is a
    // cell of one or an unaudited normalisation step decides who counts, which is a governance
    // decision nobody has made.
    // Asserted against the FORM CONTROLS, not against `getByLabelText`. The statement explaining the
    // absence is a `role="group"` whose `aria-label` necessarily contains the words "cultural
    // identity", so a label query matches the explanation and would go red for the right screen.
    expect(within(stage).queryByRole("textbox", { name: /cultural/i })).toBeNull();
    expect(
      within(stage)
        .getAllByRole("textbox")
        .map((control) => control.getAttribute("id")),
      "stage 3 collects a field it should not, or has lost one it should",
    ).toEqual([
      "caring-contacts-patient-name",
      "caring-contacts-preferred-name",
      "caring-contacts-patient-mobile",
      // The same number typed again, compared and never stored. Not a new fact collected about the
      // patient -- a second reading of the one above.
      "caring-contacts-patient-mobile-again",
      "caring-contacts-patient-identifiers",
    ]);
  });

  it("says why it is absent, so the absence does not read as an oversight", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    const group = within(stage).getByRole("group", { name: /not asked for/i });
    expect(group).toHaveTextContent(/Why:/);
    expect(group).toHaveTextContent(/What changes it:/);
    // The reason names the missing import, which is the actual cause.
    expect(group).toHaveTextContent(/read from the hospital record/i);
  });

  it("makes no present-tense claim about a capability that does not exist (I-3)", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);
    const text = stage.textContent ?? "";

    // I-3, and it is the same class of defect one sentence apart: the screen correctly refused to
    // reproduce §2.5's false "imported from the source record", then reproduced §2.5's equally
    // unbuilt "It IS used for aggregate reporting on programme reach". No reporting exists.
    //
    // THIS IS A SHAPE-PIN, NOT THE RULE, AND SAYING SO IS THE POINT (round 2, item 2).
    // The rule is "the screen makes no affirmative present-tense claim about a reach-reporting
    // capability nobody has built". That is a semantic property, and no regular expression expresses
    // it: the first version rejected two exact phrasings, so "provides aggregate reach reporting" or
    // "reach figures are produced from this" would both have passed — the same habit the round 1
    // review named, one level up, pinning a wrong SENTENCE instead of the rule.
    //
    // What is done about it: the refusal below covers a FAMILY of affirmative constructions rather
    // than two sentences, and a positive assertion pins the counterfactual framing the honest
    // wording depends on ("would depend on" / "not asked for"), so a rewrite into an affirmative
    // claim has to defeat both. What is NOT claimed: a third phrasing outside the family still
    // passes. This is recorded as an open limitation rather than treated as closed, in the same
    // spirit as `strip-source-comments.ts`'s pinned known limitation.
    const AFFIRMATIVE_REACH_CLAIM = [
      /\b(?:is|are)\s+used\s+for\b/i,
      /\bprovides?\b[^.]{0,40}\breport/i,
      /\breach\s+(?:figures|numbers|counts|data)\b/i,
      /\breport(?:s|ing)?\b[^.]{0,40}\b(?:is|are)\s+(?:produced|generated|collected|counted)\b/i,
      /\bwe\s+(?:collect|record|report|count)\b/i,
      /\bimported\s+from\s+the\b/i,
    ];
    for (const claim of AFFIRMATIVE_REACH_CLAIM) {
      expect(text, `the stage makes an affirmative claim about an unbuilt capability: ${claim}`).not.toMatch(claim);
    }

    // The positive half. The honest wording is counterfactual — it describes what the design INTENDS
    // and then says the prototype cannot do it — so the counterfactual has to still be there. A
    // rewrite that dropped it would be the defect even if it dodged every regex above.
    const absence = within(stage).getByRole("group", { name: /not asked for/i });
    expect(absence).toHaveTextContent(/would depend on/i);
    expect(absence).toHaveTextContent(/connected to no hospital record/i);
  });

  it("sends null for it, so the plan records nothing where nothing was asked", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    await user.type(within(stage).getByLabelText(/patient.s name/i), "Rowan Example");
    await user.type(within(stage).getByLabelText(/what should we call them in messages/i), "Rowan");
    await typeMobileTwice(user, stage, FICTIONAL_PATIENT_MOBILES[1]);
    await user.click(within(stage).getByRole("radio", { name: /Morning/ }));

    expect(stage.textContent ?? "").toMatch(/nothing else is needed/i);
    // `z.string().min(1).nullable()` REFUSES "", so this is not a stylistic preference: a plan
    // carrying an empty string here could not be created at all.
    expect(createPlanPatientDetail(readPlanDraft(REFERRAL)!.patientDetail)?.culturalIdentity).toBeNull();
  });
});

describe("stage 3 — validation before advancing (Ruling [115], round 1 finding I-1)", () => {
  it("proves the forward control honours `ready` at all, on the one stage where it is reachable today", async () => {
    // ROUND 1, I-1, first half. `ForwardControl` returns an `UnavailableDestination` whenever the
    // NEXT stage is unbuilt and never reads `ready` on that path — so stage 3's `ready={complete}`
    // is dead code until Task 9 builds review, and nothing was proving the prop is honoured
    // anywhere. Stage 2 is where it IS reachable: its next stage is personalisation, which Task 8
    // built. So the mechanism is proved live here, and stage 3's own gate is armed below.
    const user = userEvent.setup();
    renderWizard({ referralPathwayVersionId: null });
    for (const box of screen.getAllByRole("checkbox")) await user.click(box);
    await user.click(screen.getByRole("button", { name: /Continue to pathway/ }));

    const forward = screen.getByRole("button", { name: /Continue to personalisation/ });
    expect(forward, "the forward control was live with no pathway chosen").toBeDisabled();
    // Native `disabled` and never `aria-disabled` here: this is TRANSIENT inertness awaiting
    // validity, which is exactly what the native attribute is for, and the two must never be paired.
    expect(forward).not.toHaveAttribute("aria-disabled");

    await user.click(screen.getByRole("radio", { name: new RegExp(NAMED_PATHWAY) }));
    expect(screen.getByRole("button", { name: /Continue to personalisation/ })).toBeEnabled();
  });

  it("will require an incomplete stage 3 to be unable to advance, the moment Task 9 builds review", async () => {
    // ROUND 1, I-1, second half — and it is Task 7's self-arming shape, for the same reason: today
    // there is nothing to assert, and the moment `stages.ts` flips `review` there is a hard
    // requirement. Without this, Task 9 can ship a Continue that ignores `ready` with every gate
    // green, and a plan could be submitted with no patient name and no mobile number.
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    if (planWizardStageImplementation("review").kind === "not-built") {
      // Nothing to require yet, and this states that rather than passing silently: an enabled
      // forward control here would mean a review body had appeared behind the table's back.
      const unavailable = within(stage).getByRole("button", { name: /^Review and activation/ });
      expect(unavailable).toHaveAttribute("aria-disabled", "true");
      expect(within(stage).queryByRole("button", { name: /^Continue to review/ })).toBeNull();
      return;
    }

    // Task 9 has built it. Nothing is typed, so the control must be inert — and inert by the native
    // attribute, because awaiting validity is transient inertness.
    const incomplete = within(stage).getByRole("button", { name: /^Continue to review/ });
    expect(
      incomplete,
      "stage 3 could advance with no patient name and no mobile number — Ruling [115] requires the " +
        "mobile number to be validated BEFORE the wizard advances",
    ).toBeDisabled();
    expect(incomplete).not.toHaveAttribute("aria-disabled");

    await user.type(within(stage).getByLabelText(/patient.s name/i), "Rowan Example");
    await user.type(within(stage).getByLabelText(/what should we call them in messages/i), "Rowan");
    await typeMobileTwice(user, stage, FICTIONAL_PATIENT_MOBILES[1]);
    await user.click(within(stage).getByRole("radio", { name: /Morning/ }));
    expect(within(stage).getByRole("button", { name: /^Continue to review/ })).toBeEnabled();
  });
});

describe("stage 3 — the sending preference (kept from the mockup, minus its count)", () => {
  it("offers the three approved preferences with the time each actually sends at", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    const fieldset = within(stage).getByRole("group", { name: /when in the day/i });
    for (const option of SENDING_PREFERENCE_OPTIONS) {
      const radio = within(fieldset).getByRole("radio", { name: new RegExp(option.label) });
      expect(radio).not.toBeChecked();
      // The time is the schedule module's, resolved on the server and passed in — never a literal
      // written beside a radio button, which would go on saying 10:00 after the hour moved.
      expect(fieldset).toHaveTextContent(option.sendTime);
    }

    await user.click(within(fieldset).getByRole("radio", { name: /Early evening/ }));
    expect(readPlanDraft(REFERRAL)?.sendingPreference).toBe("earlyEvening");
  });

  it("states the invariant rather than a number of contacts (Rulings [94] and [98])", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    // The mockup's legend reads "One preference applies to all 10 contacts". The count is derived
    // and conditional — Week 1 is absorbed when the first contact is set to discharge + 7 — so the
    // property is stated and the number is not.
    expect(stage.textContent ?? "").toMatch(/applies to every contact in this plan/i);
    expect(stage.textContent ?? "").not.toMatch(/\b(10|ten|nine|9) contacts\b/i);
  });

  it("keeps every activation surface at the production tap floor", async () => {
    const user = userEvent.setup();
    renderWizard();
    const stage = await reachPersonalisationStage(user);

    // Round 1, finding I-2: `min-h-tap` must sit on the element a tap actually activates. A 48px
    // wrapper around a 20px radio is 48px of layout and 20px of activation surface, and the rest of
    // the row is dead space that looks tappable.
    for (const radio of within(stage).getAllByRole("radio")) {
      const label = radio.closest("label");
      expect(label, "a radio in stage 3 is not inside a label").not.toBeNull();
      expect(label!.className, `${label!.textContent?.trim()} is not a production tap target`).toContain("min-h-tap");
      expect(label!.className).not.toContain("min-h-11");
    }
    for (const control of within(stage).getAllByRole("button")) {
      expect(control.className, `${control.textContent?.trim()} is not a production tap target`).toContain("min-h-tap");
    }
  });
});

/**
 * Stage 4 — review and activation. The only stage that writes.
 *
 * Everything before this reads. That single fact is why most of these cases are about failure: the
 * three orderings in Ruling [117] are each silent when reversed, and the cost of each is a
 * clinician's typing or a patient's mobile number left on a ward machine.
 */
describe("stage 4 — what is read back, and what is not claimed (Ruling [119])", () => {
  it("reads the plan back from what was actually entered, and sources each fact", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    expect(stage).toHaveTextContent(REFERRAL);
    expect(stage).toHaveTextContent(PATIENT);
    expect(stage).toHaveTextContent(TEAM);
    expect(stage).toHaveTextContent(NAMED_PATHWAY);
    expect(stage).toHaveTextContent("Rowan Example");
    expect(stage).toHaveTextContent(FICTIONAL_PATIENT_MOBILES[1]);
  });

  it("names the plan's record of the confirmations as a confirmation, never as the patient's agreement", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    // The mockup renders `Agreement confirmed: Yes` beside the patient's name, as though the
    // patient's agreement were a fact the plan holds. It is not, and Task 9b did not make it one:
    // what the plan holds is that a coordinator confirmed they checked it. This screen is the last
    // place a false reassurance could be introduced before a plan exists.
    expect(stage.textContent ?? "").not.toMatch(/agreement confirmed:\s*yes/i);
    // The sentence that WAS here — "they are not recorded on the plan" — is now false, and this is
    // the pin that would have caught it surviving. What replaces it names the act and its actor.
    expect(stage).not.toHaveTextContent(/not recorded on the plan/i);
    expect(stage).toHaveTextContent(/records each of those on the plan as your confirmation/i);
    // And the going-back sentence, which asserted the plan's record could not change either way.
    // That was true when nothing was recorded and is false now.
    expect(stage).toHaveTextContent(/changes what the plan will record/i);
  });

  it("names the missing confirmation on a restored draft that skipped one, and refuses to create", async () => {
    // A draft restored from this tab's storage is parsed input, not a promise: stage 1 will not
    // advance half-ticked, but a stored draft can arrive at stage 4 that way. It must not create a
    // plan attesting a confirmation nobody made, and it must say WHICH one is outstanding rather
    // than that "at least one" is -- this is the screen whose only remedy is to go back and hunt.
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify(reviewReadyDraft({ assurances: { patientAgreed: true, mobileIsPatientControlled: false } })),
    );
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    expect(stage).toHaveTextContent(/still to confirm/i);
    expect(stage).toHaveTextContent(/that the number this plan will use is the patient.s own/i);
    // The one already made is not listed as outstanding; without this the screen could list every
    // confirmation every time and still satisfy the assertion above.
    expect(stage).not.toHaveTextContent(/still to confirm:[^.]*agreed to receive caring contacts/i);
    // SCOPED TO THE WHOLE StatedReason BLOCK, not to the paragraph.
    //
    // The previous version narrowed this to the outstanding-confirmations sentence, on the belief
    // that a region-wide match would collide with the wizard's own use of "refused" for draft
    // storage and for service refusals. Re-review traced both: `DraftNotice` renders OUTSIDE this
    // section, and every `RefusalStatement` branch needs a `state.status` / `preview.kind` this
    // fixture never reaches -- so the region-wide match was already green and the narrowing was
    // pre-emptive rather than forced. Its cost was real: the heading and "What changes it" of this
    // same block fell outside the check, and the heading had no assertion on it at all.
    //
    // The group's accessible name IS the heading, so this scope keeps the stated benefit -- no
    // coupling to unrelated copy elsewhere on the stage -- and loses neither of the other two
    // sentences. A check you believe is over-broad is a hypothesis too.
    const block = screen.getByRole("group", { name: /not all ticked/i });
    expect(block).toHaveTextContent(/still to confirm/i);
    expect(block.textContent ?? "").not.toMatch(/did not agree|refused|declined|does not consent/i);
  });

  it("tells a coordinator which confirmation is missing on the control they actually press", async () => {
    // THE SURFACE THAT MATTERS, and it was not the one the sentence reached. `unavailableReasonFor`
    // is what the activation overlay renders as the reason its decision control points at, and its
    // own doc comment promises a coordinator "is told what is missing rather than finding a control
    // that does nothing", earliest missing thing first.
    //
    // Stage 1 is the earliest and it was absent from that chain: the function consulted the state,
    // the patient detail and the preview only. On the exact path this task created -- a restored
    // half-ticked draft, patient detail present, schedule ready -- it fell through to the catch-all,
    // "The stages behind this one say which", which is the sentence that comment exists to prevent.
    const user = userEvent.setup();
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify(reviewReadyDraft({ assurances: { patientAgreed: true, mobileIsPatientControlled: false } })),
    );
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    await user.click(finalActivationTrigger());
    const action = await screen.findByTestId("workspace-overlay-action");

    // Read through `aria-describedby` rather than searching the overlay's text. That is what makes
    // this an assertion about the reason THE CONTROL POINTS AT -- the property the host's contract
    // states -- rather than about a sentence that merely happens to be somewhere on screen.
    expect(action).toHaveAttribute("aria-disabled", "true");
    const reasonId = action.getAttribute("aria-describedby");
    expect(reasonId, "the blocked control names no reason").toBeTruthy();
    const reason = document.getElementById(reasonId as string);
    expect(reason?.textContent ?? "").toMatch(/that the number this plan will use is the patient.s own/i);
    // The catch-all this branch replaces. If it is still reached, the branch is not wired -- and the
    // negative is what makes the mutation red rather than merely differently worded.
    expect(reason?.textContent ?? "").not.toMatch(/the stages behind this one say which/i);
  });

  it("says a create is running, not that a confirmation is missing, when both are true at once", async () => {
    // THE ORDER OF TWO BRANCHES, AND THE RACE I ARGUED COULD NOT HAPPEN (fix round 3).
    //
    // I put the assurance branch above `sending` on the argument that they cannot coexist: `activate`
    // returns early on a null body, and the body is null whenever a confirmation is missing, so a
    // send cannot START with one outstanding. That proves ENTRY into `sending` and says nothing about
    // the state DURING it. The status is component state; the draft is a separate external store; and
    // nothing gates the review stage's Back control, `update`, or `onAssuranceChange` on a send being
    // in flight. So a coordinator can go back mid-create, untick a box, and come back.
    //
    // With the branches the wrong way round the control then reads "Still to confirm: ..." on a
    // screen where A PLAN MAY ALREADY EXIST -- telling a coordinator the plan was never submitted at
    // the one moment that claim is most dangerous.
    //
    // The untick is made through `writePlanDraft`, which is the exact call `onAssuranceChange` makes.
    // Walking Back through three stages and forward again would exercise the wizard's navigation
    // rather than this function's ordering, and the reachability of that path is established at the
    // source: the Back control on this very stage carries no `submissionState` guard.
    const user = userEvent.setup();
    // A create that never answers, so the component stays in `sending` for the whole case.
    stubFetch(() => new Promise<Response>(() => {}));
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    await user.click(finalActivationTrigger());
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    // Positive control on the premise: the create really is in flight, or the two branches are not
    // both live and this case proves nothing about their order.
    await screen.findByText(/creating the plan and starting it/i);

    const held = readPlanDraft(REFERRAL);
    expect(held, "the draft is gone, so the untick below would prove nothing").not.toBeNull();
    writePlanDraft({
      ...(held as NonNullable<typeof held>),
      assurances: { patientAgreed: true, mobileIsPatientControlled: false },
    });

    await user.click(finalActivationTrigger());
    const action = await screen.findByTestId("workspace-overlay-action");
    const reason = document.getElementById(action.getAttribute("aria-describedby") as string);

    expect(reason?.textContent ?? "").toMatch(/the plan is being created now/i);
    // The sentence that must NOT win here, and the one the wrong order produces.
    expect(reason?.textContent ?? "").not.toMatch(/still to confirm/i);
  });

  it("states no contact count it did not measure", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    // Ruling [119]: the mockup's `"10-contact schedule"` heading is a literal and it is wrong —
    // ten ENTRIES, of which the last is a closing message, and only nine are sent when the first
    // contact moves to discharge + 7.
    expect(stage.textContent ?? "").not.toMatch(/10-contact schedule/i);
    // The closing message is named as its own kind rather than counted as one more caring contact.
    expect(stage).toHaveTextContent(/closing message/i);
  });
});

describe("stage 4 — the discharge day and the first contact, side by side (Rulings [118] and [121])", () => {
  it("collects the discharge day here, because nothing in this domain carries one", async () => {
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify(
        reviewReadyDraft({ activation: { dischargeDay: "", firstContactDay: "", firstContactReason: "" } }),
      ),
    );
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    const discharge = within(stage).getByLabelText(/day the patient was discharged/i);
    expect(discharge).toHaveAttribute("type", "date");
    // Empty rather than defaulted to today: a discharge day the screen guessed is a clinical fact
    // it invented, and every date in the plan is counted from it.
    expect(discharge).toHaveValue("");
    // And the screen says why it is asking, rather than leaving it looking like an oversight.
    expect(stage).toHaveTextContent(/counted from it/i);

    // `fireEvent.change` rather than `user.type`: a `type="date"` input sanitises every partial value
    // to "" as it is typed, so a controlled one cannot be typed into character by character at all.
    // What a browser delivers is one change carrying the finished date, which is this.
    fireEvent.change(discharge, { target: { value: DISCHARGE_DAY } });
    await waitFor(() => expect(within(stage).getByLabelText(/day of the first contact/i)).toHaveValue(bounds().usual));
  });

  it("offers exactly the days the schedule accepts, defaulting to the usual one", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    const firstContact = within(stage).getByLabelText(/day of the first contact/i);
    // Read off `firstContactDayBounds`, which derives them from the same constants
    // `buildApprovedSchedule` refuses against. A `min`/`max` written into the screen would be a
    // second copy of the rule, free to go on offering a day the schedule had stopped taking.
    expect(firstContact).toHaveAttribute("min", bounds().earliest);
    expect(firstContact).toHaveAttribute("max", bounds().latest);
    expect(firstContact).toHaveValue(bounds().usual);
  });

  it("shows the consequence of moving the day to discharge + 7 BEFORE anything is committed", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    // On the usual day nothing is suppressed and the screen must not say anything is.
    expect(stage.textContent ?? "").not.toMatch(/absorbed|suppressed/i);

    const firstContact = within(stage).getByLabelText(/day of the first contact/i);
    fireEvent.change(firstContact, { target: { value: bounds().latest } });
    const reason = await within(stage).findByLabelText(/why the first contact/i);
    await user.type(reason, "Agreed with the ward before discharge.");

    // RULING [118]'s own sentence: the system is about to remove a contact from a
    // suicide-prevention schedule as a side effect of a date choice, and it must say so in place,
    // while the choice is still being made. `fetch` is never stubbed in this case, so nothing has
    // been committed and nothing could have been.
    await waitFor(() => expect(within(stage).getByRole("group", { name: /suppressed/i })).toBeInTheDocument());
    expect(stage).toHaveTextContent(/Week 1/);
    expect(stage).toHaveTextContent(/9 still to send/i);
  });

  it("shows what the day COSTS before asking the clinician to justify it (round 2, I3)", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    const firstContact = within(stage).getByLabelText(/day of the first contact/i);
    fireEvent.change(firstContact, { target: { value: bounds().latest } });

    // NO REASON HAS BEEN TYPED. The schedule refuses `first-contact-reason-required` in this state,
    // so a consequence built from the submittable preview did not appear until after the clinician
    // had justified the choice -- telling them what it costs only once they had defended it. The
    // consequence is an input to the decision, not a receipt for it.
    expect(within(stage).getByLabelText(/why the first contact/i)).toHaveValue("");
    await waitFor(() => expect(within(stage).getByRole("group", { name: /suppressed/i })).toBeInTheDocument());
    expect(stage).toHaveTextContent(/Week 1/);
    expect(stage).toHaveTextContent(/9 messages rather than 10/i);
  });

  it("asks for a reason on a moved day, and names the schedule's own two refusals apart", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizard();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    // No reason is asked for while the first contact is on the usual day, because none is required.
    expect(within(stage).queryByLabelText(/why the first contact/i)).toBeNull();

    const firstContact = within(stage).getByLabelText(/day of the first contact/i);
    fireEvent.change(firstContact, { target: { value: bounds().earliest } });

    const reason = await within(stage).findByLabelText(/why the first contact/i);
    // `first-contact-reason-required` — stated, not merely implied by an inert control.
    await waitFor(() => expect(stage).toHaveTextContent(/without a reason for the moved day/i));

    await user.click(reason);
    await user.paste("x".repeat(FIRST_CONTACT_REASON_MAX_LENGTH + 1));
    // `first-contact-reason-too-long` — a DIFFERENT refusal, and the two must not read alike: one
    // says write something, the other says write less. A single "the schedule could not be built"
    // for both would leave a clinician deleting the reason they were just asked for.
    await waitFor(() => expect(stage).toHaveTextContent(/reason is too long/i));
    expect(stage.textContent ?? "").not.toMatch(/without a reason for the moved day/i);
  });
});

describe("stage 4 — the identifiers are minted once and reused (Ruling [120])", () => {
  it("mints a plan identifier and an idempotency key when the stage is reached, and keeps them", async () => {
    const user = userEvent.setup();
    renderWizard();
    await reachReviewStage(user);

    const minted = readPlanDraft(REFERRAL)?.submission ?? null;
    expect(minted).not.toBeNull();
    expect(minted?.planId).toBeTruthy();
    expect(minted?.createIdempotencyKey).toBeTruthy();

    // Back to stage 3 and forward again is exactly the shape a clinician takes after a failure, and
    // it must not mint a second identity: a fresh plan id on the retry is how one patient ends up
    // with two plans, two schedules and two sets of messages.
    await user.click(screen.getByRole("button", { name: /Back to personalisation/ }));
    await user.click(screen.getByRole("button", { name: /^Continue to review/ }));
    expect(
      readPlanDraft(REFERRAL)?.submission,
      "the identifiers were minted again on a second visit, so a retry would create a second plan",
    ).toEqual(minted);
  });
});

describe("stage 4 — the write, and the three orderings (Ruling [117])", () => {
  it("writes nothing until the confirmation overlay's own decision control is used", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => createdPlanAnswer());
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    // Opening the decision surface is not the decision. Task 3 built `overlay-trigger.tsx` to
    // require a commit handler at the TYPE level so a screen cannot open one it has not wired; this
    // is the other half — the wiring must not fire on the way in.
    await user.click(finalActivationTrigger());
    expect(await screen.findByTestId("workspace-overlay-action")).toBeInTheDocument();
    expect(fetched).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("workspace-overlay-action"));
    // Two writes now (Ruling [123]); the property here is that neither happened before the
    // decision control was used, not how many there are.
    await waitFor(() => expect(fetched).toHaveBeenCalled());
  });

  it("confirms the plan was created, THEN clears the draft, THEN navigates", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const fetched = stubFetch(async () => {
      order.push("fetch-answered");
      // The draft is still here at the moment the answer arrives: clearing before the response
      // would lose a clinician's typing on any failure.
      order.push(readPlanDraft(REFERRAL) === null ? "draft-already-cleared" : "draft-still-held");
      // A create answer carrying the version the second write needs. `{ value: null }` is no longer
      // a stand-in for success (Ruling [123]) -- it is a plan whose version nothing can name, which
      // has its own case further down.
      return createdPlanAnswer();
    });
    navigation.push.mockImplementation(() => {
      order.push(readPlanDraft(REFERRAL) === null ? "navigate-after-clear" : "navigate-before-clear");
    });

    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    expect(fetched).toHaveBeenCalledTimes(2);
    // Navigating before clearing leaves a patient's name and mobile number in that tab's storage on
    // a shared ward computer, with the screen already gone — which is what Ruling [110]'s third
    // requirement exists to prevent.
    expect(order).toEqual(["fetch-answered", "draft-still-held", "navigate-after-clear"]);
    expect(readPlanDraft(REFERRAL)).toBeNull();
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("navigates to the plan it just created, on the patient's own screen", async () => {
    const user = userEvent.setup();
    stubFetch(async () => createdPlanAnswer());
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });
    const minted = readPlanDraft(REFERRAL)?.submission ?? null;
    await confirmActivation(user);

    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const href = navigation.push.mock.calls[0][0] as string;
    // Built from `caring-contacts-routes.ts`, never a path literal, and it must be a route that
    // exists: `/caring-contacts/plans/<id>` has no page, so linking there would be a 404.
    expect(href.startsWith(patientRoute(PATIENT))).toBe(true);
    expect(href).toContain(`${CARING_CONTACTS_PLAN_QUERY_PARAM}=${minted?.planId}`);
  });

  it("says WHICH failure it was, in place, and never only that something went wrong", async () => {
    const cases = [
      { refusal: "action-not-granted", status: 403, expected: /role cannot create a plan/i },
      { refusal: "duplicate-active-plan", status: 409, expected: /already has a plan/i },
      { refusal: "first-contact-reason-required", status: 422, expected: /without a reason for the moved day/i },
    ];

    for (const item of cases) {
      const user = userEvent.setup();
      window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
      stubFetch(async () => jsonResponse({ refusal: item.refusal }, item.status));
      const view = renderWizardWithOverlays();
      const stage = await screen.findByRole("region", { name: "Review and activation" });
      await confirmActivation(user);

      await waitFor(() => expect(stage, `${item.refusal} was not explained in place`).toHaveTextContent(item.expected));
      expect(stage.textContent ?? "", `${item.refusal} was reported as a general failure`).not.toMatch(
        /something went wrong/i,
      );
      // And the clinician is told their typing survived, which is the fact they need first.
      expect(stage).toHaveTextContent(/still on this computer/i);

      view.unmount();
      vi.restoreAllMocks();
      clearPlanDraft();
      clearStagedWorkspaceOverlayCommit();
      window.sessionStorage.clear();
    }
  });

  it("retries with the SAME plan identifier, so a second press cannot create a second plan", async () => {
    const user = userEvent.setup();
    const bodies: Record<string, unknown>[] = [];
    let answered = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      bodies.push(JSON.parse(String((init as RequestInit).body)));
      answered += 1;
      // The first attempt is refused for a reason that clears by itself, which is exactly when a
      // clinician presses again.
      return answered === 1 ? jsonResponse({ refusal: "service-stopped" }, 423) : createdPlanAnswer();
    });

    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    await confirmActivation(user);
    await waitFor(() => expect(bodies).toHaveLength(1));
    await confirmActivation(user);
    await waitFor(() => expect(bodies.filter((body) => "referralId" in body)).toHaveLength(2));

    const creates = bodies.filter((body) => "referralId" in body);
    const [first, second] = creates as { planId: string; idempotencyKey: string }[];
    // THE WHOLE POINT of a caller-supplied key. Reused, the second attempt is refused as a replay
    // and returns the first attempt's own answer; minted fresh, it creates a second plan for one
    // patient — two schedules, two sets of messages, found by the patient rather than the system.
    expect(second.planId, "the retry minted a new plan identifier").toBe(first.planId);
    expect(second.idempotencyKey, "the retry minted a new idempotency key").toBe(first.idempotencyKey);
  });

  it("offers no decision control at all while the plan could not be created", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => createdPlanAnswer());
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify(
        reviewReadyDraft({ activation: { dischargeDay: "", firstContactDay: "", firstContactReason: "" } }),
      ),
    );
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    await user.click(finalActivationTrigger());
    const action = await screen.findByTestId("workspace-overlay-action");

    // The overlay opens and states what cannot be done, rather than the screen offering a dead
    // button behind it — the shape `overlay-commits.ts` calls `{ kind: "unavailable" }`, whose
    // reason the host renders as text the control points at.
    expect(action).toHaveAttribute("aria-disabled", "true");
    await user.click(action);
    expect(fetched).not.toHaveBeenCalled();
  });

  it("puts production tap targets on the controls it adds", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    // 48px, and never `min-h-11`: this repo's floor exceeds even the AAA-level criterion because
    // 44px hit a sub-pixel rounding flake in `ui-smoke`. On the element that contains the control,
    // not on a wrapping div — a 48px wrapper around a 20px control is dead space that looks
    // tappable.
    for (const control of [
      within(stage).getByLabelText(/day the patient was discharged/i),
      within(stage).getByLabelText(/day of the first contact/i),
      within(stage).getByRole("button", { name: /Back to personalisation/ }),
      finalActivationTrigger(),
    ]) {
      const name = control.getAttribute("id") ?? control.textContent ?? "a control";
      expect(control.className, `${name} is not a production tap target`).toContain("min-h-tap");
      expect(control.className, `${name} uses the 44px step`).not.toContain("min-h-11");
    }
  });
});

describe("stage 4 — the plan is created AND started, and the gap between is a real state (Ruling [123])", () => {
  /** Both writes answered in order, recording the URL each one went to. */
  function stubBothWrites(answers: { create: () => Promise<Response>; activate: () => Promise<Response> }) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      calls.push({ url, body: JSON.parse(String((init as RequestInit).body)) });
      return url.endsWith("/api/caring-contacts/plans") ? answers.create() : answers.activate();
    });
    return calls;
  }

  it("creates the plan and then starts it, in that order, from the create's own version", async () => {
    const user = userEvent.setup();
    const calls = stubBothWrites({
      create: async () => jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version: 3 } } }),
      activate: async () => jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "active", version: 4 } } }),
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });
    const minted = readPlanDraft(REFERRAL)?.submission ?? null;
    await confirmActivation(user);

    await waitFor(() => expect(calls).toHaveLength(2));
    // The wizard IS the activation workflow: the frozen overlay's own title is "Last check before
    // the plan starts", and a create alone leaves a plan in `draft` that nothing in this workspace
    // can start.
    expect(calls[0].url).toBe("/api/caring-contacts/plans");
    expect(calls[1].url).toBe(`/api/caring-contacts/plans/${minted?.planId}`);
    expect(calls[1].body.action).toBe("activate");
    // Read out of the create's answer, never assumed to be 1: guessing would be right today and
    // wrong the moment anything touches the plan between the two writes.
    expect(calls[1].body.expectedVersion).toBe(3);
    // A SECOND key. The create's key here would be refused as a replay of a different request, so
    // the plan would exist and could never be started.
    expect(calls[1].body.idempotencyKey).toBe(minted?.activateIdempotencyKey);
    expect(calls[1].body.idempotencyKey).not.toBe(minted?.createIdempotencyKey);
  });

  it("clears the draft and navigates only after BOTH writes have succeeded", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      const stage = url.endsWith("/api/caring-contacts/plans") ? "create" : "activate";
      order.push(`${stage}-answered`);
      order.push(readPlanDraft(REFERRAL) === null ? `draft-cleared-before-${stage}` : `draft-held-at-${stage}`);
      return jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version: 1 } } });
    });
    navigation.push.mockImplementation(() => {
      order.push(readPlanDraft(REFERRAL) === null ? "navigate-after-clear" : "navigate-before-clear");
    });

    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    // The draft is still held at the SECOND write, not only the first: it carries the plan id and
    // both keys, which is the only thing that makes the second write a retry rather than a new plan.
    expect(order).toEqual([
      "create-answered",
      "draft-held-at-create",
      "activate-answered",
      "draft-held-at-activate",
      "navigate-after-clear",
    ]);
    expect(readPlanDraft(REFERRAL)).toBeNull();
  });

  it("KEEPS the draft when the plan was created and could not be started", async () => {
    const user = userEvent.setup();
    stubBothWrites({
      create: async () => jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version: 1 } } }),
      activate: async () => jsonResponse({ refusal: "service-stopped" }, 423),
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });
    const minted = readPlanDraft(REFERRAL)?.submission ?? null;
    await confirmActivation(user);

    // THE ONE PLACE "clear on success" NEEDS REFINING, and Ruling [120]'s mechanism is the reason:
    // the draft holds the plan id and both keys, and that is exactly what distinguishes "try again"
    // from "create a second plan for this patient". Clearing it here would throw that away.
    await waitFor(() => expect(stage).toHaveTextContent(/has not started/i));
    expect(
      readPlanDraft(REFERRAL)?.submission,
      "the draft was cleared after a partial write, so a retry would create a second plan",
    ).toEqual(minted);
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("says the plan exists rather than reporting a partial write as a total failure", async () => {
    const user = userEvent.setup();
    stubBothWrites({
      create: async () => jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version: 1 } } }),
      activate: async () => jsonResponse({ refusal: "service-stopped" }, 423),
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    await waitFor(() => expect(stage).toHaveTextContent(/has not started/i));
    // A coordinator told "nothing was created" starts the sign-up again, and this patient gets a
    // second plan, two schedules and two sets of messages. So the screen must say the opposite of
    // what a total failure says.
    expect(stage.textContent ?? "").not.toMatch(/nothing was created/i);
    expect(stage).toHaveTextContent(/the plan was created/i);
    expect(stage).toHaveTextContent(/same plan|cannot create a second|will not create another/i);
  });

  it("finishes a half-done submission on the next press, without creating a second plan", async () => {
    const user = userEvent.setup();
    let activateAttempts = 0;
    const calls = stubBothWrites({
      create: async () => jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "draft", version: 1 } } }),
      activate: async () => {
        activateAttempts += 1;
        // Refused once for a reason that clears by itself, which is exactly when a coordinator
        // presses again.
        return activateAttempts === 1
          ? jsonResponse({ refusal: "service-stopped" }, 423)
          : jsonResponse({ value: { plan: { id: "SYN-PLAN-X", state: "active", version: 2 } } });
      },
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });
    const minted = readPlanDraft(REFERRAL)?.submission ?? null;

    await confirmActivation(user);
    await waitFor(() => expect(stage).toHaveTextContent(/has not started/i));
    await confirmActivation(user);
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));

    // Four calls: create, activate, create again, activate again. The second create is a REPLAY —
    // same plan id, same key — so the store answers with the first one's result rather than making
    // a second plan. That is the entire reason the key is caller-supplied.
    expect(calls).toHaveLength(4);
    expect(calls[2].url).toBe("/api/caring-contacts/plans");
    expect(calls[2].body.planId).toBe(minted?.planId);
    expect(calls[2].body.idempotencyKey).toBe(minted?.createIdempotencyKey);
    expect(calls[3].body.idempotencyKey).toBe(minted?.activateIdempotencyKey);
    expect(readPlanDraft(REFERRAL)).toBeNull();
  });

  it("treats a create that answers without a version as created-but-not-started", async () => {
    const user = userEvent.setup();
    const calls = stubBothWrites({
      create: async () => jsonResponse({ value: null }),
      activate: async () => jsonResponse({ value: null }),
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    // The plan was created — the create answered 200 — but nothing here can name the version the
    // second write needs, so the second write is not attempted rather than sent with a guess.
    await waitFor(() => expect(stage).toHaveTextContent(/has not started/i));
    expect(calls).toHaveLength(1);
    expect(readPlanDraft(REFERRAL)).not.toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("still reports a create that failed as nothing created at all", async () => {
    const user = userEvent.setup();
    const calls = stubBothWrites({
      create: async () => jsonResponse({ refusal: "duplicate-active-plan" }, 409),
      activate: async () => jsonResponse({ value: null }),
    });
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    // The second write must not be attempted against a plan that does not exist, and the wording
    // must not claim one does — this is the branch the partial-failure wording would be false in.
    await waitFor(() => expect(stage).toHaveTextContent(/already has a plan/i));
    expect(calls).toHaveLength(1);
    expect(stage.textContent ?? "").not.toMatch(/the plan was created/i);
    expect(readPlanDraft(REFERRAL)?.patientDetail.patientName).toBe("Rowan Example");
  });
});

/**
 * ROUND 2, C1. The sentence a coordinator reads at the moment of decision, pinned.
 *
 * It was false and nothing caught it: it told them the plan would not run and that the starting
 * step did not exist, while `activate()` did both writes and the overlay beside it said "Last check
 * before the plan starts". **No test read any of that prose**, which is exactly why it survived the
 * code changing underneath it. These cases exist so the next change to `activate()` cannot leave
 * the copy behind.
 */
describe("stage 4 — what the screen promises matches what confirming does (Ruling [123], round 2 C1)", () => {
  it("tells the coordinator, at the control, that confirming creates AND starts the plan", async () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    const stage = await screen.findByRole("region", { name: "Review and activation" });

    expect(stage).toHaveTextContent(/creates this plan and starts it/i);
    // The three claims that were false, named individually so a partial revert is caught.
    expect(stage.textContent ?? "", "the screen says confirming does not start the plan").not.toMatch(
      /does not start it/i,
    );
    expect(stage.textContent ?? "", "the screen says the plan is created in draft").not.toMatch(/created in draft/i);
    expect(stage.textContent ?? "", "the screen says starting is a step this workspace lacks").not.toMatch(
      /separate step and this workspace does not have it yet/i,
    );
  });

  it("labels the control for both writes, agreeing with the overlay it opens", async () => {
    const user = userEvent.setup();
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });

    // The frozen row is titled "Last check before the plan starts" and its decision reads "Confirm
    // and activate". A control labelled "Create this plan" in front of it was the third leg of a
    // three-way contradiction on one screen.
    expect(finalActivationTrigger()).toHaveTextContent(/create and start this plan/i);

    await user.click(finalActivationTrigger());
    await screen.findByTestId("workspace-overlay-content");
    // The frozen title is rendered by the Sheet's own header at dialog modality, which is OUTSIDE
    // the content node -- so this reads the document rather than the overlay body.
    expect(document.body.textContent ?? "").toMatch(/last check before the plan starts/i);
    expect(screen.getByTestId("workspace-overlay-action")).toHaveTextContent(/confirm and activate/i);
  });

  it("says the plan was created AND started once both writes have landed", async () => {
    const user = userEvent.setup();
    stubFetch(async () => createdPlanAnswer());
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
    renderWizardWithOverlays();
    await screen.findByRole("region", { name: "Review and activation" });
    await confirmActivation(user);

    // The success panel omitted the start, which understates what just happened on a screen whose
    // whole subject is whether a suicide-prevention schedule is running.
    const panel = await screen.findByRole("region", { name: "Plan created" });
    expect(panel).toHaveTextContent(/created and started/i);
    expect(panel).toHaveTextContent(/schedule is running/i);
  });

  it("carries no comment claiming this screen performs one write, in either file it writes from", () => {
    // The `stages.ts` defect: a comment describing a mechanism the code no longer has. This is the
    // REGRESSION PIN, not the habit — see the Task 9 report. Two ways round 2's version was too
    // narrow, both of which let a survivor through:
    //
    //   * it grepped two literal phrases, so it could not see a paraphrase — and it missed
    //     "Where the one write has got to" IN THE VERY FILE IT GUARDED;
    //   * it read `plan-wizard.tsx` only, while every sentence a clinician reads in the
    //     created-but-not-started state lives in `plan-activation.ts`.
    //
    // So it now reads both files and matches a FAMILY of single-write claims rather than two
    // sentences. A phrase pin cannot be made complete — a fourth phrasing outside the family still
    // passes — and that limitation is stated here rather than left for the next reader to find, in
    // the same spirit as `strip-source-comments.ts`'s pinned known limitation.
    const singleWriteClaims = [
      /\bthe one write\b/i,
      /\bone write its brief names\b/i,
      /\bno ruling covers performing two writes\b/i,
      /\bperforms (?:the|a) single write\b/i,
      /\bthis screen performs one write\b/i,
      /\bcreated in draft\b/i,
      /\bdoes not start it\b/i,
    ];

    for (const name of ["plan-wizard.tsx", "plan-activation.ts"]) {
      const source = readFileSync(
        path.join(process.cwd(), "src", "components", "caring-contacts", "workspace", "plan-wizard", name),
        "utf8",
      );
      for (const claim of singleWriteClaims) {
        expect(source, `${name} still carries a single-write claim matching ${claim}`).not.toMatch(claim);
      }

      // THE SECOND CLASS, and it is a different defect from a stale mechanism claim: a COUNT stated
      // in prose. `activationRefusalWording`'s doc said "Every branch says three things", and round
      // 2's own C3 edit falsified the middle one for three branches while the third had never been
      // true of two others. Ruling [94] — state the invariant, not the count — applies to source as
      // much as to a screen, because a comment is not re-read when the code beneath it changes.
      // ROUND 4 WIDENING. The two patterns above matched neither of the counts that survived round
      // 3 -- "Three branches withhold it" and "Two of those three tell the clinician NOT to press
      // again" -- which sat directly above the sentence saying counts are not restated here. Worse,
      // the second was FALSE: only `plan-not-draft` says not to press; `plan-terminal` says nothing
      // either way and `service-answered-with-something-unreadable` invites it. A tally nobody
      // re-derives is how a paragraph written to correct an over-claim came to make one.
      //
      // Deliberately narrow. A general "<numeral> of those" pattern collides with ordinary prose in
      // these files ("one of them", "one of the two confirmations", "every one of them"), so it
      // would fail on sentences that are fine and teach the next author to disable it. These two
      // shapes match the defect and nothing currently in either file.
      for (const claim of [
        /every branch says (?:one|two|three|four|five|\d+) things/i,
        /all (?:thirteen|\d+) branches say/i,
        /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+)\s+branches\b/i,
        /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\s+of\s+(?:those|the)\s+(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen)\b/i,
      ]) {
        expect(source, `${name} restates a branch count in prose, which decays`).not.toMatch(claim);
      }
    }
  });
});

/**
 * ROUND 2, I1. Five refusal shapes, five cases.
 *
 * These were one case with a `for` loop, and M9 falsified all five through a single code path — so
 * no individual shape was pinned and a refusal shape that stopped being handled would not have gone
 * red. One `it` per shape is what makes each one falsifiable on its own.
 */
describe("stage 4 — the draft survives every shape of failed write (Ruling [117], round 2 I1)", () => {
  const SHAPES = [
    { label: "a lost connection", answer: () => Promise.reject(new TypeError("Failed to fetch")) },
    { label: "a permission refusal", answer: async () => jsonResponse({ refusal: "action-not-granted" }, 403) },
    { label: "an existing plan", answer: async () => jsonResponse({ refusal: "duplicate-active-plan" }, 409) },
    {
      label: "a schedule refusal",
      answer: async () => jsonResponse({ refusal: "first-contact-reason-required" }, 422),
    },
    { label: "an answer that is not JSON", answer: async () => new Response("<html>", { status: 200 }) },
  ];

  for (const shape of SHAPES) {
    it(`keeps the whole draft after ${shape.label}`, async () => {
      const user = userEvent.setup();
      window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(reviewReadyDraft()));
      const fetched = stubFetch(shape.answer);
      renderWizardWithOverlays();
      await screen.findByRole("region", { name: "Review and activation" });
      await confirmActivation(user);

      await waitFor(() => expect(fetched).toHaveBeenCalled());
      // A clinician who has typed a name, a mobile number and identifiers and then meets a failure
      // must lose none of it.
      await waitFor(() =>
        expect(readPlanDraft(REFERRAL)?.patientDetail.patientName, "the draft was lost on a failed write").toBe(
          "Rowan Example",
        ),
      );
      expect(navigation.push, "the screen navigated away from a plan that was not created").not.toHaveBeenCalled();
    });
  }
});

/**
 * Task 11a — the seven decision overlays this wizard now offers, and the two moments each is
 * guarded at.
 *
 * WHY EVERY CASE HERE RENDERS THE HOST. `WorkspaceOverlays` is mounted by the shell in production
 * and takes no props, so rendering it beside the wizard is what lets a case press the frozen
 * decision control rather than reach past it and call the commit directly. A case that called the
 * commit itself would prove the write and skip the confirmation step, which is the half the frozen
 * matrix is actually about.
 */
describe("the caring-contacts plan wizard — Task 11a's decision overlays", () => {
  /** Every trigger for a row, found by the id it stamps rather than by its visible words. */
  function decisionTriggers(overlayId: string): HTMLElement[] {
    return screen
      .getAllByTestId("workspace-overlay-trigger")
      .filter((element) => element.getAttribute("data-overlay-trigger") === overlayId);
  }

  /**
   * The one trigger for a row.
   *
   * `perRow` is `pathway-preview` and nothing else: its frozen decision is "Use this pathway", so a
   * stage offering three approved versions offers three of them and a uniqueness check would fail on
   * a correct screen. Stated as a property of the ROW rather than relaxed for every row, so a second
   * control appearing on a row that should have one is still an error.
   */
  function decisionTrigger(overlayId: string, perRow = false): HTMLElement {
    const matches = decisionTriggers(overlayId);
    if (matches.length === 0) throw new Error(`no trigger for "${overlayId}" is on screen`);
    if (!perRow && matches.length !== 1) {
      throw new Error(`expected exactly one trigger for "${overlayId}" on screen, found ${matches.length}`);
    }
    return matches[0];
  }

  /** Raises a row and returns its decision control, having checked the host raised the right row. */
  async function openDecision(
    user: ReturnType<typeof userEvent.setup>,
    overlayId: string,
    perRow = false,
  ): Promise<HTMLElement> {
    await user.click(decisionTrigger(overlayId, perRow));
    const content = await screen.findByTestId("workspace-overlay-content");
    expect(content, "the host opened a different row from the one the trigger names").toHaveAttribute(
      "data-overlay-id",
      overlayId,
    );
    return screen.getByTestId("workspace-overlay-action");
  }

  /**
   * The seven rows and how a coordinator reaches each, in the stage order the wizard walks.
   *
   * `discard-changes` and `save-draft` sit in the draft notice, which every stage renders, so they
   * are reachable from the first screen — the pair is how a coordinator steps away from a
   * half-finished sign-up, and only one of the two leaves a patient's details on the machine.
   */
  const DECISION_ROWS: readonly {
    id: string;
    reach: (user: ReturnType<typeof userEvent.setup>) => Promise<unknown>;
    /** True where the frozen decision names a thing on the row, so a stage offers one control each. */
    perRow?: boolean;
  }[] = [
    { id: "verify-identity", reach: async () => undefined },
    { id: "change-patient", reach: async () => undefined },
    { id: "discard-changes", reach: async () => undefined },
    { id: "save-draft", reach: async () => undefined },
    { id: "pathway-preview", reach: reachPathwayStage, perRow: true },
    { id: "communication-preference", reach: reachPersonalisationStage },
    { id: "message-preview", reach: reachPersonalisationStage },
  ];

  for (const row of DECISION_ROWS) {
    it(`reaches ${row.id} from a control, and its decision is wired rather than refused`, async () => {
      const user = userEvent.setup();
      renderWizardWithOverlays();
      await row.reach(user);

      const trigger = decisionTrigger(row.id, row.perRow);
      // The production tap floor and the forced-colors border come from the trigger's own base
      // class. Asserted here because these call sites pass a `className`, and a caller that
      // replaced the base rather than adding to it would lose both silently.
      expect(trigger.className, `${row.id}'s control is not a production tap target`).toContain("min-h-tap");
      expect(trigger.className, `${row.id}'s control was narrowed to the 44px guidance`).not.toContain("min-h-11");
      expect(trigger.className, `${row.id}'s control disappears under forced colours`).toContain("forced-colors:");

      const action = await openDecision(user, row.id, row.perRow);
      // THE WHOLE POINT OF RULING 87, ASKED OF EVERY ROW: a decision surface a screen has opened
      // without wiring shows its control refused. None of these is.
      expect(action, `${row.id} opened a decision the screen has not wired`).not.toHaveAttribute("aria-disabled");
    });
  }

  it("CONTROL: the same assertion goes red for a row opened by address, with no control behind it", async () => {
    // The positive control for the loop above. `?overlay=` typed or pasted stages no commit, so a
    // MUTATING row's decision is refused with the named reason and `aria-disabled` — which is what
    // proves `not.toHaveAttribute("aria-disabled")` is capable of failing rather than decorative.
    renderWizardWithOverlays();
    act(() => {
      window.history.pushState(null, "", "/caring-contacts/plans/new?overlay=verify-identity");
      window.dispatchEvent(new Event("popstate"));
    });

    const action = await screen.findByTestId("workspace-overlay-action");
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).toHaveAttribute("aria-describedby");
  });

  // 2026-09-26. The identity check used to name no person at all, so "compare the person selected
  // here" had nothing on screen to compare.
  it("shows the patient details the identity check compares, from the referral's intake record", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays({
      intakePrefill: {
        patientIdentifier: "UR-00219384",
        givenName: "Rowan",
        familyName: "Example",
        mobileNumber: FICTIONAL_PATIENT_MOBILES[1],
        dischargeDate: "2026-03-10T12:00:00+08:00",
        hospitalFacility: "Royal Perth Hospital",
        cohort: "adult_crisis",
        admittingWard: "",
        clinicalSummary: "",
        safetyAlerts: [],
      },
    });
    await openDecision(user, "verify-identity");
    const facts = screen.getByTestId("workspace-overlay-facts");
    expect(facts).toHaveTextContent("NameRowan Example");
    expect(facts).toHaveTextContent("Record numberUR-00219384");
    expect(facts).toHaveTextContent("HospitalRoyal Perth Hospital");
    expect(facts).toHaveTextContent("Discharged10 March 2026");
  });

  it("lists the person, pathway and sending times in the last check before the plan starts", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await reachReviewStage(user);
    await user.click(finalActivationTrigger());
    const facts = await screen.findByTestId("workspace-overlay-facts");
    expect(facts).toHaveTextContent("PersonRowan Example");
    expect(facts).toHaveTextContent(`Pathway${NAMED_PATHWAY}`);
    expect(facts).toHaveTextContent(/Sending timesMorning/);
  });

  it("says the name is not held when the referral carries no intake record", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await openDecision(user, "verify-identity");
    const facts = screen.getByTestId("workspace-overlay-facts");
    expect(facts).toHaveTextContent("NameNot held on this referral");
    expect(facts).toHaveTextContent(`Synthetic patient identifier${PATIENT}`);
  });

  it("refuses a decision confirmed after the sign-up was removed, and puts nothing back", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    // A sign-up exists on this computer: the first tick writes it.
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();

    const action = await openDecision(user, "verify-identity");
    // AT OPEN TIME IT WAS PERMITTED, and this line is the reason the case is shaped this way: an
    // overlay that only checked when it opened passes here and fails everything below.
    expect(action, "the decision was already refused before the state changed").not.toHaveAttribute("aria-disabled");

    // The state changes while the surface sits open — what `change-patient`, a successful
    // activation, or a draft belonging to another referral each do.
    act(() => {
      clearPlanDraft();
    });

    await user.click(action);

    const refusal = await screen.findByTestId("caring-contacts-decision-refusal");
    // Named from the frozen table, so a clinician is told WHICH decision did not happen.
    expect(refusal).toHaveTextContent(/Verify identity was not carried out/);
    // Held to expected content rather than to the module's own value: an assertion reading the
    // constant on both sides agrees with itself however the constant is emptied.
    expect(refusal).toHaveTextContent("This sign-up was removed from this computer while this was open");
    expect(refusal).toHaveTextContent(/nothing was put back/i);
    // The remedy this row's refusal offers, pinned HERE so the discard case below can assert its
    // absence and mean something. Without this line "does not say start the sign-up again" would be
    // satisfied by a screen that never says it anywhere.
    expect(refusal).toHaveTextContent(/Start the sign-up again/i);
    // THE CLAUSE NOBODY WRITES. A refusal that appeared while the commit still ran would satisfy
    // every line above. A commit built on the draft it closed over would have written a whole
    // sign-up — a patient's name and mobile number included — back into this tab's storage after
    // something had deliberately removed it.
    expect(
      window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY),
      "the refused decision put the sign-up back on the machine",
    ).toBeNull();
  });

  it("pins the refusal wording it renders to the module that owns it", () => {
    // The other half of the pair above, and the reason both exist: the case above holds the SCREEN
    // to literal words, and this holds the MODULE to the same words. Emptying the constant reddens
    // this one; rendering something else reddens that one. One assertion reading the constant on
    // both sides would survive either.
    expect(WIZARD_DECISION_REFUSALS["sign-up-still-here"]).toContain(
      "This sign-up was removed from this computer while this was open",
    );
    expect(WIZARD_DECISION_REFUSALS["draft-survives-leaving-this-screen"]).toContain(
      "This browser is not writing this sign-up down",
    );
    // And the one row whose words differ, held to its own literal for the same reason.
    //
    // TWO ASSERTIONS, NOT ONE OPTIONAL CHAIN. The first version read
    // `OVERRIDES["discard-changes"]?.["sign-up-still-here"]` and went red when the row key was
    // renamed -- but with "the given combination of arguments (undefined and string) is invalid for
    // this assertion", which names neither the row nor the wording. A degenerate receiver is still a
    // failure, but it cannot tell "the override is gone" from "the wording changed", and that is the
    // whole distinction this pin exists to draw.
    expect(
      Object.hasOwn(WIZARD_DECISION_REFUSAL_OVERRIDES, "discard-changes"),
      "discard-changes no longer has its own refusal wording, so it falls back to the sentence that tells a coordinator to start again",
    ).toBe(true);
    expect(WIZARD_DECISION_REFUSAL_OVERRIDES["discard-changes"]["sign-up-still-here"]).toContain(
      "there was nothing left to discard",
    );
  });

  it("CONTROL: records the identity check when nothing changed while the surface was open", async () => {
    // The positive control for the refusal above. Without it, a commit that recorded nothing at all
    // would satisfy every assertion in that case — "nothing was written" is exactly what a broken
    // commit and a correctly refused one look like from storage.
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await user.click(screen.getAllByRole("checkbox")[0]);

    const action = await openDecision(user, "verify-identity");
    await user.click(action);

    expect(screen.queryByTestId("caring-contacts-decision-refusal")).toBeNull();
    expect(readPlanDraft(REFERRAL)?.decisions.identityChecked, "the confirmed decision recorded nothing").toBe(true);
    // And the screen reads it back, naming the destination rather than only the act: this system
    // distinguishes held in a tab's storage from written onto a plan, and ordinary English does not.
    const state = await screen.findByTestId("caring-contacts-identity-check-state");
    expect(state).toHaveTextContent(/confirmed that this is the right person/i);
    expect(state).toHaveTextContent(/kept on this computer for this tab/i);
    expect(state).toHaveTextContent(/written onto no plan/i);
  });

  it("refuses Leave this for now once the browser stops writing the sign-up down, and does not navigate", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await user.click(screen.getAllByRole("checkbox")[0]);

    const action = await openDecision(user, "save-draft");
    expect(action, "the decision was already refused before the browser changed its answer").not.toHaveAttribute(
      "aria-disabled",
    );

    // Safari private browsing hands out a real `sessionStorage` whose `setItem` throws, and
    // `plan-draft.ts` falls back to a draft that lasts as long as the PAGE. `Storage.prototype`,
    // not the instance — jsdom's storage is a Proxy that answers from the prototype, so an
    // instance spy is never consulted and the test would pass inert.
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    act(() => {
      const current = readPlanDraft(REFERRAL);
      if (current === null) throw new Error("the fixture sign-up was never written down");
      writePlanDraft(current);
    });
    expect(setItem, "the storage refusal was never actually exercised").toHaveBeenCalled();

    await user.click(action);

    const refusal = await screen.findByTestId("caring-contacts-decision-refusal");
    expect(refusal).toHaveTextContent(/Save draft was not carried out/);
    expect(refusal).toHaveTextContent("This browser is not writing this sign-up down");
    // Leaving is the whole of this decision, so proving it did not happen is proving the refusal.
    expect(navigation.push, "the screen left a sign-up the browser had stopped keeping").not.toHaveBeenCalled();
  });

  it("CONTROL: Leave this for now leaves the sign-up where it is and goes to this team's plans", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await user.click(screen.getAllByRole("checkbox")[0]);
    const before = window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY);
    expect(before).not.toBeNull();

    await user.click(await openDecision(user, "save-draft"));

    expect(screen.queryByTestId("caring-contacts-decision-refusal")).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith(CARING_CONTACTS_ROUTES.patients);
    // The pair's whole distinction: this one keeps what `discard-changes` removes.
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY), "leaving threw the sign-up away").toBe(before);
  });

  it("removes the sign-up before it leaves when the patient is the wrong one", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBeNull();

    await user.click(await openDecision(user, "change-patient"));

    // Ordered as Ruling [117] orders the activation pair, pointed the other way: the draft holds a
    // patient's name and mobile number from stage 3 onward, so it goes before the screen does.
    expect(
      window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY),
      "the wrong patient's sign-up was left on the machine",
    ).toBeNull();
    expect(navigation.push).toHaveBeenCalledWith(CARING_CONTACTS_ROUTES.patients);
  });

  it("chooses the version a pathway preview was opened from, and says which row it came from", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await reachPathwayStage(user);
    // The referral names one already (Ruling [113]), so choosing the other is a real change rather
    // than a first choice agreeing with what was already there.
    expect(readPlanDraft(REFERRAL)?.pathwayVersionId).toBe(NAMED_PATHWAY);

    const triggers = decisionTriggers("pathway-preview");
    expect(triggers, "one preview control per approved version").toHaveLength(2);
    // One row's control is told from another's by its accessible name, because the drawer they
    // open is generic and cannot name the version itself.
    const other = triggers.find((element) => element.textContent?.includes(OTHER_PATHWAY));
    expect(other, `no preview control named the ${OTHER_PATHWAY} row`).toBeDefined();

    await user.click(other!);
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    expect(readPlanDraft(REFERRAL)?.pathwayVersionId, "confirming the preview chose nothing").toBe(OTHER_PATHWAY);
    expect(screen.getByRole("radio", { name: new RegExp(OTHER_PATHWAY) })).toBeChecked();
  });

  it("tells a read-only row from a recording one by what each leaves behind", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await reachPersonalisationStage(user);
    const before = window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY);
    expect(before).not.toBeNull();

    // NO CHANGE. `message-preview` is `mutatesState: false`; its decision is an exit and the host's
    // own close is the whole of it, so the sign-up is untouched.
    await user.click(await openDecision(user, "message-preview"));
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY), "a read-only row changed the sign-up").toBe(before);
    expect(readPlanDraft(REFERRAL)?.decisions.preferenceGivenOnStaffedLine).toBe(false);

    // AND SUCCESS, so that "unchanged" above means something. Held to expected content on this
    // side, then compared on the other: two reads of one store that only agree with each other
    // would agree perfectly however the store was emptied.
    await user.click(await openDecision(user, "communication-preference"));
    expect(readPlanDraft(REFERRAL)?.decisions.preferenceGivenOnStaffedLine, "the recording row recorded nothing").toBe(
      true,
    );
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).not.toBe(before);

    const source = await screen.findByTestId("caring-contacts-preference-source");
    expect(source).toHaveTextContent(/asked for this time through the staffed programme phone/i);
    expect(source).toHaveTextContent(/written onto no plan/i);
  });

  it("states beside the preview that no external action occurred, in words rather than by omission", async () => {
    const user = userEvent.setup();
    renderWizardWithOverlays();
    const stage = await reachPersonalisationStage(user);

    // The frozen `message-preview` summary says what a preview shows and says nothing about
    // sending, so the screen that offers it carries that sentence. `OverlayHost` renders each row's
    // frozen copy and takes no children, so the surface itself cannot be made to carry it.
    expect(stage).toHaveTextContent(/Nothing in this prototype is ever sent to any number/i);
    expect(stage).toHaveTextContent(/It is a specimen/i);
  });

  it("renders the patient-visible wording it is handed, rather than one of its own", async () => {
    const user = userEvent.setup();
    // A stand-in the sealed domain does not contain. Passing the real constant here would compare
    // the prop with itself: the assertion could not fail, whatever the screen rendered.
    render(
      <>
        <PlanWizard {...wizardProps({ patientVisibleMessageSpecimen: "SYNTHETIC-SPECIMEN-WORDING-11A" })} />
        <WorkspaceOverlays />
      </>,
    );
    await reachPersonalisationStage(user);

    expect(screen.getByTestId("caring-contacts-message-specimen")).toHaveTextContent("SYNTHETIC-SPECIMEN-WORDING-11A");
  });

  it("says where Leave this for now takes you, which the frozen drawer it opens does not", async () => {
    // THE AGREEMENT CASE THIS ROW LACKED — the equivalent of stage 4's "labels the control for both
    // writes, agreeing with the overlay it opens". `save-draft` is a three-way statement: the
    // control says "Leave this for now", the frozen drawer says "Save this activation draft" /
    // "Save draft" / "The draft is kept as it stands", and confirming writes nothing and NAVIGATES.
    // The matrix's Navigation clause asks for the destination to be announced, and the drawer copy
    // is the approved design, so the screen is what has to carry it.
    const user = userEvent.setup();
    renderWizardWithOverlays();

    // In the control's own accessible name, so it is heard before anything is opened.
    const trigger = decisionTrigger("save-draft");
    expect(trigger).toHaveAccessibleName(/takes you to this team's plans/i);

    // And in the flow of the page, beside the control it contrasts with — the pair differs in
    // whether a patient's details stay on this machine AND in whether the screen changes.
    const destinations = screen.getByTestId("caring-contacts-draft-exit-destinations");
    expect(destinations).toHaveTextContent(
      /Leave this for now keeps this sign-up on this computer and takes you to this team's plans/i,
    );
    expect(destinations).toHaveTextContent(/Discard draft removes it and stays on this screen/i);
    // POSITIVE CONTROL FOR THE ABSENCE BELOW. The drawer assertion is a `not.toMatch`, and a
    // regex that matches nothing would satisfy it however the drawer read. The same regex is
    // asserted to MATCH this paragraph first, so its absence from the drawer means something.
    expect(
      destinations.textContent ?? "",
      "the regex used below matches nothing, so its absence from the drawer proves nothing",
    ).toMatch(/leav|takes? you|team's plans/i);

    // THE GAP THIS CLOSES, ASSERTED RATHER THAN DESCRIBED. The frozen drawer never mentions leaving,
    // so a coordinator who read only the confirmation would not know the screen was about to change.
    // If the owner ever amends that copy to say so, this goes red and names the remedy — the
    // announcement should then move into the drawer rather than being said twice.
    await user.click(trigger);
    const content = await screen.findByTestId("workspace-overlay-content");
    expect(content).toHaveAttribute("data-overlay-id", "save-draft");
    expect(
      content.textContent ?? "",
      "the frozen drawer now mentions leaving — move the announcement into it rather than saying it twice",
    ).not.toMatch(/leav|takes? you|team's plans/i);
  });

  it("refuses an already-gone discard in words that are true of a discard", async () => {
    // THE DEFECT: `sign-up-still-here` fires when the sign-up has gone while the surface was open,
    // and its own sentence ends "Start the sign-up again from this team's plans." On every other row
    // that is the remedy. On this one the coordinator ASKED for the sign-up to go, it has gone, and
    // they were being refused and told to restart — for the outcome they wanted and already have.
    const user = userEvent.setup();
    renderWizardWithOverlays();
    await user.click(screen.getAllByRole("checkbox")[0]);

    const action = await openDecision(user, "discard-changes");
    expect(action, "the decision was already refused before the state changed").not.toHaveAttribute("aria-disabled");

    act(() => {
      clearPlanDraft();
    });
    await user.click(action);

    const refusal = await screen.findByTestId("caring-contacts-decision-refusal");
    expect(refusal).toHaveTextContent(/Discard changes was not carried out/);
    expect(refusal).toHaveTextContent("there was nothing left to discard");
    expect(refusal).toHaveTextContent(/which is what you were asking for/i);
    // The half that was wrong. Its counterpart is pinned on the verify-identity case above, so this
    // absence is a contrast between two rows rather than a sentence nothing says anywhere.
    expect(refusal, "a coordinator who got what they asked for is told to undo it").not.toHaveTextContent(
      /Start the sign-up again/i,
    );
    // Still a refusal rather than silent success: this press did not perform the removal, so
    // reporting it as done would claim an action it did not take. And nothing was put back.
    expect(window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("keeps the sealed message module out of this client component altogether", () => {
    // The other half of the case above, and the one a screen author would actually break: rendering
    // what it is handed is only half of "never author patient-visible copy". A wizard that imported
    // `message-copy` could hold a second copy of the wording — and would pull that module and the
    // GSM-7 machinery it imports into this route's client chunk.
    const wizardSource = stripSourceComments(
      readFileSync(
        path.join(process.cwd(), "src", "components", "caring-contacts", "workspace", "plan-wizard", "plan-wizard.tsx"),
        "utf8",
      ),
    );
    // THE POSITIVE CONTROL FOR BOTH ABSENCES BELOW, and it is the one that got away first time.
    // `stripSourceComments` is a helper with no test of its own, so a regression that made it return
    // an empty string would silence every `not.toContain` here while the case stayed green. This
    // asserts the scan actually read the component before concluding anything about what it lacks.
    expect(wizardSource, "the source scan read nothing, so the two absences below are vacuous").toContain(
      "export function PlanWizard",
    );
    expect(wizardSource, "the wizard reaches for the sealed message module itself").not.toContain("message-copy");
    // And the words themselves are not written out here under another name.
    expect(wizardSource, "a patient-visible greeting was written into the wizard").not.toMatch(/thinking of you/i);
  });
});

/**
 * Ruling [126], round 1 finding I2.
 *
 * Stage 2 prints "Approved by the clinical programme lead and the lived-experience representative"
 * for whatever version it is offered. A demonstration population produces a version whose approvals
 * are structurally genuine — the domain refused anything else — and which no person ever approved,
 * and nothing about the shape of the record distinguishes the two. So the record carries a
 * provenance and this screen says it. The screen never infers it: a version claiming nothing gets
 * no extra line, which is the second case here.
 */
describe("the pathway stage — approvals nobody gave are not presented as approvals", () => {
  const SYNTHETIC_NOTE = "Invented for demonstration: no person recorded either approval.";

  it("prints the record's provenance beside the approval, in the option's own described region", async () => {
    const user = userEvent.setup();
    renderWizard({
      pathwayOptions: [pathwayOption(NAMED_PATHWAY, SYNTHETIC_NOTE), pathwayOption(OTHER_PATHWAY)],
    });
    await reachPathwayStage(user);

    expect(screen.getByText(SYNTHETIC_NOTE)).toBeInTheDocument();
    expect(screen.getAllByTestId(PATHWAY_PROVENANCE_TESTID)).toHaveLength(1);

    // Tied to the OPTION, not floating in the panel: the radio's `aria-describedby` region has to
    // contain it, or a screen reader announces an approval with no qualifier attached to it.
    const radio = screen.getByRole("radio", { name: new RegExp(NAMED_PATHWAY) });
    const describedBy = radio.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy!)).toHaveTextContent(SYNTHETIC_NOTE);
  });

  it("says nothing extra about a version whose record claims no provenance", async () => {
    const user = userEvent.setup();
    renderWizard({ pathwayOptions: [pathwayOption(OTHER_PATHWAY)] });
    const panel = await reachPathwayStage(user);

    expect(panel).toHaveTextContent(/Approved by the clinical programme lead/);
    expect(screen.queryByText(SYNTHETIC_NOTE)).toBeNull();
    expect(panel.textContent ?? "").not.toMatch(/invented|demonstration/i);
    // The ELEMENT, not only its text. A null note renders as an empty paragraph, so asserting on
    // wording alone cannot see the condition being removed -- a mutant survived exactly that gap.
    expect(screen.queryAllByTestId(PATHWAY_PROVENANCE_TESTID)).toHaveLength(0);
  });
});
