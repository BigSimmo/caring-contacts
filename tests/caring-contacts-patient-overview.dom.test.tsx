// tests/caring-contacts-patient-overview.dom.test.tsx
//
// `/caring-contacts/patients/[patientId]` (`src/app/caring-contacts/patients/[patientId]/page.tsx`)
// -- one patient's episode, and the ONE screen in this workspace that may call `getEpisode`.
//
// THE CONTRACTS THIS FILE EXISTS FOR
//
//   1. Ruling 97. The route is keyed by PATIENT, the reads are keyed by PLAN, and one patient can
//      honestly hold two episodes -- `repository.ts` says so, and `markRetentionCleared` clears
//      detail per plan, so two plans for one patient can legitimately differ in what they hold. The
//      screen therefore never picks between them: zero plans is an honest empty state, one plan
//      renders, and more than one asks. A screen that silently picked would show one plan's
//      schedule under a heading carrying the patient's name.
//
//   2. `getEpisode` is called ONCE, for ONE plan, and only after that rule has picked the plan. It
//      is the read that releases the name, the mobile number, the identifiers and the cultural
//      identity together, so "how many times was it called, and with what" is the assertion, not a
//      detail. The chooser must not call it at all.
//
//   3. Ruling 98. The contact count is DERIVED. Week 1 is suppressed exactly when the first
//      contact is discharge + 7, which makes that plan nine sendable messages rather than ten, and
//      the last entry is a CLOSING message rather than one more caring contact. Nothing here may
//      be a literal.
//
//   4. Ruling 96's display half, and Ruling 108's three cases under it. The first contact date is
//      shown; when it is not the default of discharge + 1 the screen must say so in place, and show
//      the recorded REASON in the clinician's own words. When no reason is held the screen says
//      WHICH absence it is -- a role that may not read the episode, a retention clearance, or a plan
//      older than the field -- because those are three different facts and only one of them is
//      about the plan being old.
//
// Built on the helper shape `caring-contacts-patients-page.dom.test.tsx` established for Task 5.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: mocks.notFound,
  // `PlanActions` asks the router to read the rest of this screen again after a change lands. There
  // is no app-router context in jsdom, so the real hook throws; this is the same substitution the
  // wizard's own suite makes for `push`.
  useRouter: () => mocks.router,
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { assertExitOnlyOverlayRow } from "@/components/caring-contacts/workspace/overlays/exit-only-overlay-trigger";
import { overlayDefinition } from "@/components/caring-contacts/workspace/overlays/definitions";
import { clearStagedWorkspaceOverlayCommit } from "@/components/caring-contacts/workspace/overlays/overlay-commits";
import { WorkspaceOverlays } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import {
  planActionCardName,
  planActionConditions,
  PLAN_ACTION_CONDITION_REFUSALS,
} from "@/components/caring-contacts/workspace/plan-action-rules";
import type { PlanActionId, PlanActionsContext } from "@/components/caring-contacts/workspace/plan-action-rules";
import { PatientOverview, type PatientOverviewView } from "@/components/caring-contacts/workspace/patient-overview";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { CARING_CONTACT_ROLE_WORDING } from "@/lib/caring-contacts/permissions";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import {
  PLAN_ASSURANCES,
  PLAN_ASSURANCE_VALUES,
  planAssuranceWording,
  type PlanAssurance,
  type PlanAssuranceAttestation,
} from "@/lib/caring-contacts/assurances";
import {
  actorId,
  contactId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  type PlanId,
} from "@/lib/caring-contacts/ids";
import type { ContactState, MessageType } from "@/lib/caring-contacts/model";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";
import type { NextRequest } from "next/server";

import { movableClock } from "./helpers/caring-contacts-movable-clock";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";
const STORE_CLOCK = movableClock(NOW);
/** 15 Aug 2026 in AWST -- the discharge day every plan below hangs off. */
const DISCHARGE = new Date("2026-08-15T02:00:00.000Z");
const DISCHARGE_DAY = "2026-08-15";
const DEFAULT_FIRST_CONTACT_DAY = "2026-08-16";
const ABSORBING_FIRST_CONTACT_DAY = "2026-08-22"; // discharge + 7: Week 1 is absorbed
const PATIENT = "SYN-PATIENT-001";

type Spied = {
  store: CaringContactRepository;
  recorded: () => AccessRecord[];
  episodeCalls: () => string[];
};

/**
 * The real in-memory store, with `recordAccess` and `getEpisode` observed.
 *
 * The real store rather than a hand-built stub, deliberately: this screen's whole subject is the
 * SCHEDULE the domain built -- the absorbed Week 1, the closing message, the cadence labels -- and
 * a stub would let the test assert against a schedule the domain would never produce.
 */
function spiedStore(role = "coordinator"): Spied {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };

  // Movable, and put back to NOW for every store: a retention clearance is admitted only seven
  // years after a plan ended (owner decision 2026-09-26), so the cleared-episode cases move it.
  STORE_CLOCK.set(NOW);
  const repository = createInMemoryRepository(STORE_CLOCK);
  const records: AccessRecord[] = [];
  const episodeCalls: string[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      await repository.recordAccess(record);
      records.push(record);
    },
    async getEpisode(id, context) {
      episodeCalls.push(id);
      return repository.getEpisode(id, context);
    },
  };

  mocks.store.current = store;
  return { store, recorded: () => records, episodeCalls: () => episodeCalls };
}

/** Creates one plan through the real store, so its schedule is the domain's own. */
async function createPlan(
  store: CaringContactRepository,
  id: string,
  options: { patient?: string; firstContactDate?: string; firstContactReason?: string } = {},
): Promise<PlanId> {
  const actor = demoActorForRole("coordinator");
  const result = await store.createPlan(
    {
      planId: planId(id),
      referralId: referralId(`referral-${id}`),
      patientId: patientId(options.patient ?? PATIENT),
      pathwayVersionId: pathwayVersionId("pathway-1"),
      dischargeAt: DISCHARGE,
      sendingPreference: "morning",
      firstContactDate: options.firstContactDate,
      firstContactReason: options.firstContactReason,
      patientDetail: {
        patientName: "Rowan Sample",
        patientMobileNumber: "0400000000",
        patientIdentifiers: ["SYN-UMRN-001"],
        culturalIdentity: "Not stated",
        preferredName: "Rowan",
      },
      assurances: PLAN_ASSURANCE_VALUES,
    },
    { actor, idempotencyKey: idempotencyKey(`create-${id}`) },
  );
  if (!result.ok) throw new Error(`createPlan(${id}) refused: ${result.reason}`);
  return planId(id);
}

/**
 * Ends a plan, so the patient may hold a second one.
 *
 * `createPlan` refuses a second NON-TERMINAL plan for the same patient across every team, which is
 * what makes "one patient, two episodes" an honest state rather than a duplicate-message hazard:
 * the first has to have ended. A draft is not withdrawable, so the plan is activated first, and
 * withdrawal is what sets `completedAt` -- which `admitRetentionClearance` then requires.
 */
async function endPlan(store: CaringContactRepository, id: PlanId) {
  const actor = demoActorForRole("coordinator");
  const activated = await store.activatePlan(
    { planId: id, expectedVersion: 1 },
    { actor, idempotencyKey: idempotencyKey(`activate-${id}`) },
  );
  if (!activated.ok) throw new Error(`activatePlan(${id}) refused: ${activated.reason}`);
  const result = await store.withdrawPlan(
    { planId: id, expectedVersion: activated.value.plan.version, origin: "patient" },
    { actor, idempotencyKey: idempotencyKey(`withdraw-${id}`) },
  );
  if (!result.ok) throw new Error(`withdrawPlan(${id}) refused: ${result.reason}`);
}

/**
 * Records a death against a live plan, through the real store.
 *
 * The other path to a plan of cancelled contacts: `recordHospitalStatusEvent`'s `cancelUnsent`
 * outcome runs every unsent contact through `{ type: "cancel" }`, exactly as `withdrawPlan` does.
 * It is the case the screen must never get wrong -- a plan whose patient has died, announcing that
 * its messages are still to come.
 */
async function recordDeath(store: CaringContactRepository, id: PlanId) {
  const actor = demoActorForRole("coordinator");
  const activated = await store.activatePlan(
    { planId: id, expectedVersion: 1 },
    { actor, idempotencyKey: idempotencyKey(`activate-death-${id}`) },
  );
  if (!activated.ok) throw new Error(`activatePlan(${id}) refused: ${activated.reason}`);
  const result = await store.recordHospitalStatusEvent(
    {
      planId: id,
      expectedVersion: activated.value.plan.version,
      event: { type: "death", recordedAt: new Date(NOW) },
    },
    { actor, idempotencyKey: idempotencyKey(`death-${id}`) },
  );
  if (!result.ok) throw new Error(`recordHospitalStatusEvent(${id}) refused: ${result.reason}`);
}

/**
 * Makes one plan answer like a row created before the first-contact reason was kept.
 *
 * No store can produce such a plan any more: `createPlan` always writes what the schedule accepted,
 * and no write removes a reason on its own. But old rows hold null forever -- nothing was migrated
 * into them, deliberately (Ruling 108) -- so the case is real and has to be renderable. It is
 * staged at the boundary the screen actually reads, `getEpisode`, answered with null in that one
 * field and untouched in every other, which is exactly how an old row answers.
 *
 * Deliberately NOT done by reaching into the store's state: that would depend on the in-memory
 * store's internals, and the case being staged is a property of the DATA, not of either store.
 */
function forgetFirstContactReason(store: CaringContactRepository, plan: string): void {
  const patched: CaringContactRepository = {
    ...store,
    async getEpisode(id, context) {
      const episode = await store.getEpisode(id, context);
      if (episode === null || String(id) !== plan) return episode;
      return { ...episode, firstContactReason: null };
    },
  };
  mocks.store.current = patched;
}

async function renderPage(
  patient = PATIENT,
  searchParams: Record<string, string | string[] | undefined> = {},
): Promise<ReactElement> {
  const { default: PatientOverviewPage } = await import("@/app/caring-contacts/patients/[patientId]/page");
  const element = await PatientOverviewPage({
    params: Promise.resolve({ patientId: patient }),
    searchParams: Promise.resolve(searchParams),
  });
  // The shell is the page's root; the overview it wraps is what this file inspects. Rendering the
  // shell itself would drag `next/dynamic` and the whole workspace chrome into a test about one
  // screen's body -- the same split `caring-contacts-patients-page.dom.test.tsx` makes.
  render((element as ReactElement<{ children: ReactElement }>).props.children);
  return element;
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  mocks.notFound.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the patient overview - Ruling 97: one plan, and the screen never chooses which", () => {
  it("says this team holds no plan for the patient rather than 404ing, and never calls getEpisode", async () => {
    const { episodeCalls } = spiedStore();

    await renderPage();

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(episodeCalls()).toEqual([]);
    expect(screen.getByRole("group", { name: "No plan for this patient" })).toBeInTheDocument();
    // The answer must not distinguish "no plan exists" from "the plan is on another team".
    expect(screen.getByText(/another team/i)).toBeInTheDocument();
  });

  it("says the ROLE cannot see plans when it holds no viewReferral, never that there is no plan", async () => {
    const { episodeCalls } = spiedStore("auditor");
    // The plan exists and is this team's; the auditor simply may not list it.
    const coordinatorStore = mocks.store.current as CaringContactRepository;
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    await createPlan(coordinatorStore, "plan-solo");
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "auditor" } };

    await renderPage();

    expect(screen.getByRole("group", { name: "Plans are not visible in this role" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "No plan for this patient" })).not.toBeInTheDocument();
    expect(episodeCalls()).toEqual([]);
  });

  it("renders the one plan, calling getEpisode exactly once and for that plan", async () => {
    const { store, episodeCalls, recorded } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    expect(episodeCalls()).toEqual(["plan-solo"]);
    expect(screen.getByRole("heading", { level: 2, name: "Rowan Sample" })).toBeInTheDocument();
    // Its own object type and its own row on the trail, keyed by the plan it released.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "episode", objectId: "plan-solo", outcome: "allowed" }),
    );
  });

  it("asks which plan when the patient has two and the URL names none, and does NOT call getEpisode", async () => {
    const { store, episodeCalls } = spiedStore();
    const first = await createPlan(store, "plan-first");
    await endPlan(store, first);
    await createPlan(store, "plan-second");

    await renderPage();

    expect(episodeCalls()).toEqual([]);
    expect(screen.getByRole("heading", { level: 2, name: /more than one plan/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plan-first/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /plan-second/ })).toBeInTheDocument();
    // A chooser takes the name from the narrow read, never from `getEpisode`.
    expect(screen.getByText("Rowan Sample")).toBeInTheDocument();
  });

  it("renders the plan the URL names, once the plan is proved to belong to this patient", async () => {
    const { store, episodeCalls } = spiedStore();
    const first = await createPlan(store, "plan-first");
    await endPlan(store, first);
    await createPlan(store, "plan-second");

    await renderPage(PATIENT, { plan: "plan-first" });

    expect(episodeCalls()).toEqual(["plan-first"]);
  });

  it("ignores a ?plan= naming another patient's plan, and falls back to asking", async () => {
    const { store, episodeCalls } = spiedStore();
    const first = await createPlan(store, "plan-first");
    await endPlan(store, first);
    await createPlan(store, "plan-second");
    await createPlan(store, "plan-elsewhere", { patient: "SYN-PATIENT-002" });

    await renderPage(PATIENT, { plan: "plan-elsewhere" });

    expect(episodeCalls()).toEqual([]);
    expect(screen.getByRole("heading", { level: 2, name: /more than one plan/i })).toBeInTheDocument();
  });

  // M7, review round 1: the documented rule is now pinned rather than only described. `?plan=` is
  // consulted only when there is something to choose between; with exactly one plan that plan
  // renders whatever the URL says, so a stale or mistyped link cannot turn a one-plan patient into
  // a one-item chooser, and cannot withhold a plan this actor may see.
  it("renders the sole plan even when ?plan= names another patient's, and reads only the sole plan", async () => {
    const { store, episodeCalls } = spiedStore();
    await createPlan(store, "plan-solo");
    await createPlan(store, "plan-elsewhere", { patient: "SYN-PATIENT-002" });

    await renderPage(PATIENT, { plan: "plan-elsewhere" });

    // The foreign plan is neither read nor named nor acknowledged.
    expect(episodeCalls()).toEqual(["plan-solo"]);
    expect(document.body.textContent).not.toContain("plan-elsewhere");
    expect(screen.queryByRole("heading", { level: 2, name: /more than one plan/i })).not.toBeInTheDocument();
    // And the reader is told which plan they are looking at.
    expect(screen.getByTestId("caring-contacts-plan-summary")).toHaveTextContent("plan-solo");
  });

  it("ignores a repeated ?plan=a&plan=b, which names no single plan", async () => {
    const { store, episodeCalls } = spiedStore();
    const first = await createPlan(store, "plan-first");
    await endPlan(store, first);
    await createPlan(store, "plan-second");

    await renderPage(PATIENT, { plan: ["plan-first", "plan-second"] });

    expect(episodeCalls()).toEqual([]);
  });
});

describe("the patient overview - Ruling 98: the contact count is derived, never a literal", () => {
  it("counts ten entries, all sendable, for a plan on the default first contact", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const schedule = screen.getByRole("list", { name: "Twelve-month schedule" });
    expect(within(schedule).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries, and every one of them is still to be sent.",
    );
  });

  it("counts NINE sendable when Week 1 is absorbed by a discharge + 7 first contact", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });

    await renderPage();

    const schedule = screen.getByRole("list", { name: "Twelve-month schedule" });
    // The absorbed entry is still an entry -- it is kept so the interface can explain the plan.
    expect(within(schedule).getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries: 9 still to send, and 1 that will not be sent.",
    );
  });

  it("says WHY the absorbed entry will not be sent, in place beside it", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });

    await renderPage();

    const suppressed = screen.getByRole("group", { name: "Suppressed" });
    expect(suppressed).toHaveTextContent(/same calendar day as this plan's first contact/i);
    expect(suppressed).toHaveTextContent(/two caring contacts must never land on one day/i);
    expect(suppressed).toHaveTextContent(/different first-contact date/i);
  });

  it("labels the last entry a closing message, not one more caring contact", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const entries = within(screen.getByRole("list", { name: "Twelve-month schedule" })).getAllByRole("listitem");
    expect(entries.at(-1)).toHaveTextContent("Closing message");
    expect(entries.at(-1)).not.toHaveTextContent("Caring contact");
    expect(entries[0]).toHaveTextContent("First message");
  });
});

describe("the patient overview - Ruling 96: the first contact date is shown, and a move is explained", () => {
  it("shows the default first contact and names it as the usual day", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    expect(screen.getByTestId("caring-contacts-first-contact")).toHaveTextContent(DEFAULT_FIRST_CONTACT_DAY);
    expect(screen.getByTestId("caring-contacts-first-contact")).toHaveTextContent(/the day after discharge/i);
    expect(screen.queryByRole("note", { name: /First contact moved/i })).not.toBeInTheDocument();
  });

  it("shows a moved first contact's recorded reason IN PLACE, in the clinician's own words", async () => {
    // Ruling 108, second case, and spec 4.4's contract: a reason reachable only by hovering has
    // not been stated. It is rendered verbatim and attributed, never paraphrased into the
    // surrounding sentence.
    const { store } = spiedStore();
    await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });

    await renderPage();

    const note = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(note).toHaveTextContent(ABSORBING_FIRST_CONTACT_DAY);
    expect(note).toHaveTextContent(/7 days after discharge/i);
    expect(note).toHaveTextContent("Patient was interstate for the first week.");
    expect(note).toHaveTextContent(/coordinator who created it gave this reason/i);
    // The old gap sentence is gone: the reason IS kept with the plan now.
    expect(note).not.toHaveTextContent(/not kept with the plan/i);
  });

  it("says an older plan predates the field, rather than blaming a coordinator (Ruling 108)", async () => {
    // The third case, and the one that will persist: a plan created before the column existed
    // holds null forever, because no placeholder was migrated into old rows. Reproduced here by
    // clearing the reason on a stored plan directly, which is the only way this suite can produce
    // a row the store itself can no longer create.
    const { store } = spiedStore();
    await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });
    forgetFirstContactReason(store, "plan-solo");

    await renderPage();

    const note = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(note).toHaveTextContent(/created before reasons were kept with the plan/i);
    expect(note).toHaveTextContent(/Nobody failed to give one/i);
    expect(note).not.toHaveTextContent("Patient was interstate for the first week.");
  });

  it("names the retention clearance when a cleared episode holds no reason", async () => {
    // A cleared episode ALSO holds no reason, and saying "this plan predates the field" about one
    // would be a false statement on a clinical record. The screen tells them apart the same way
    // `NoNameHeldNotice` does -- a blank name on a released episode is the clearance.
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });
    await endPlan(store, id);
    STORE_CLOCK.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: id },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("clear-reason-plan-solo") },
    );
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    await renderPage();

    const note = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(note).toHaveTextContent(/retention clearance has since removed it/i);
    expect(note).not.toHaveTextContent(/created before reasons were kept/i);
    expect(note).not.toHaveTextContent("Patient was interstate for the first week.");
  });

  it("says the reason is part of a record this role may not read, and claims nothing about it", () => {
    // Review round 1, I-2. The fourth branch had no covering test: every `episode: null` render in
    // this file uses a discharge + 1 first contact, so all of them land in the default-day branch
    // and none reaches this prose at all. It could have been deleted or garbled with every gate
    // green -- which is what M13 below now demonstrates it cannot be.
    //
    // Built as a direct `PatientOverview` render rather than through the page, for the reason the
    // module comment gives: `episode: null` is a fact about the ACTOR that the PAGE decides, never
    // something this screen infers from an empty read. `permissions.ts` currently grants
    // `generateClinicalRecordSummary` to exactly the roles holding `viewReferral`, so no role can
    // produce this view through the store today, and a fixture that reached for one would be
    // asserting a grant rather than the branch.
    const record: PlanRecord = {
      plan: { id: planId("plan-x"), teamId: demoActorForRole("coordinator").teamId, state: "active", version: 1 },
      mobileCheck: { state: "notChecked", sentAt: null, resolvedAt: null },
      patientId: patientId(PATIENT),
      referralId: referralId("referral-x"),
      pathwayVersionId: pathwayVersionId("pathway-1"),
      dischargeAt: DISCHARGE,
      // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
      // plan's creation instant is set to the same instant as its discharge rather than invented.
      createdAt: DISCHARGE,
      completedAt: null,
      outcome: "inProgress",
      assuranceAttestations: [],
      contacts: [
        {
          contact: { id: contactId("plan-x--contact-1"), planId: planId("plan-x"), state: "scheduled", version: 1 },
          planned: {
            sequence: 1,
            cadenceLabel: "Day 1",
            // Deliberately the ABSORBING day, not the default: a discharge + 1 first contact would
            // render the usual-day sentence and never reach the branch under test.
            calendarDay: ABSORBING_FIRST_CONTACT_DAY,
            sendAt: new Date("2026-08-22T02:00:00.000Z"),
            messageType: "first",
          },
        },
      ],
    };

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    const note = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(note).toHaveTextContent(ABSORBING_FIRST_CONTACT_DAY);
    expect(note).toHaveTextContent(/not visible in the role you are acting in/i);
    // The load-bearing half: absence here is a fact about the actor, so the screen must not turn it
    // into a claim about the record. Each of the other three branches would be a false statement.
    expect(note).toHaveTextContent(/says nothing about whether one is held/i);
    expect(note).not.toHaveTextContent(/created before reasons were kept/i);
    expect(note).not.toHaveTextContent(/retention clearance/i);
  });

  it("claims no clearance for a blank name that no clearance produced (#J7PZQP)", async () => {
    // THE DEFECT, STATED AS A TEST. This branch used to be selected by `patientName === ""`, so an
    // episode holding a blank name for any other reason made the screen tell a clinician three
    // definite things about a live record: that a reason was given, that a clearance removed it,
    // and that the removal is irreversible.
    //
    // The state is reachable: `patient_name` is `not null` with NO CHECK against the empty string,
    // and neither store's `createPlan` validates a non-blank name. The only thing standing between
    // a blank name and this screen was `z.string().min(1)` in the plans API route -- one schema, at
    // one edge, holding up a sentence stated as fact on a patient record.
    //
    // The episode is overridden rather than written through the store because the domain refuses a
    // moved first contact with no reason, so no sequence of real writes reaches "blank name, no
    // reason, never cleared". That is the point: the component must not depend on which states
    // happen to be constructible today. It is the same override technique the preferred-name case
    // below uses, and the surrounding record is still the store's own.
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });
    const record = await store.getPlan(id, { actor: demoActorForRole("coordinator") });
    const episode = await store.getEpisode(id, { actor: demoActorForRole("coordinator") });
    if (record === null || episode === null) throw new Error("the fixture plan was not readable");

    // Positive control: this episode really was never cleared, so the assertions below are the
    // screen declining to claim a clearance rather than there being nothing to claim one about.
    expect(episode.patientDetailClearedAt).toBeNull();

    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({
          record,
          episode: { ...episode, patientName: "", firstContactReason: null },
          otherPlanCount: 0,
        })}
      />,
    );

    const note = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(note).not.toHaveTextContent(/retention clearance has since removed it/i);
    expect(note).not.toHaveTextContent(/A clearance is not reversible/i);
    // POSITIVELY, not only by absence. Asserting what a branch no longer says leaves whatever it
    // now says unpinned, and the reason branch has four outcomes. This one rests on a real domain
    // invariant -- a moved first contact REQUIRES a reason, so a null reason must predate the
    // field -- rather than on the name sentinel, which is what makes it still true here.
    expect(note).toHaveTextContent(/created before reasons were kept with the plan/i);
    expect(note).toHaveTextContent(/Nobody failed to give one/i);

    // And the identity notice reports the absence -- which is real -- without naming a cause it
    // cannot know. Saying nothing at all would be the opposite failure.
    const identity = screen.getByRole("note", { name: "No name is held for this patient" });
    expect(identity).toHaveTextContent(/cannot say why the name is absent, and will not guess/i);
    expect(identity).not.toHaveTextContent(/A retention clearance removed the name/i);

    // AND IT DOES NOT CLAIM THE MOBILE NUMBER IS GONE (review finding). This episode still holds
    // one; only the name was blanked. Deducing "no number either" from a blank name is the same
    // unchecked inference this whole change removes, and an earlier draft of the fix kept it.
    expect(episode.patientMobileNumber).not.toBe("");
    expect(identity).toHaveTextContent(/a mobile number is still held for it/i);
    expect(identity).not.toHaveTextContent(/no mobile number is held for it either/i);
  });

  it("shows the discharge day the whole calendar hangs off", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    expect(screen.getByTestId("caring-contacts-plan-summary")).toHaveTextContent(DISCHARGE_DAY);
  });
});

describe("the patient overview - what it may show about the person", () => {
  // Review round 1, owner decision. The first version withheld the mobile number and flagged it;
  // the owner reversed that. `getEpisode` already releases it on this screen, so it is taken from
  // the episode already in hand -- no read was added and none was widened.
  it("renders the patient's mobile number on the identity strip, labelled as invented", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const identity = screen.getByRole("heading", { level: 2, name: "Rowan Sample" }).closest("section");
    expect(identity).not.toBeNull();
    expect(identity).toHaveTextContent("Mobile number:");
    expect(identity).toHaveTextContent("0400000000");
    // The one field on this screen a reader might act on, so the context travels with it.
    expect(identity).toHaveTextContent(/invented, and nothing in this workspace is ever sent to it/i);
  });

  // Not a control, and deliberately not dialable: nothing in this workspace calls anybody.
  it("renders the number as text, never as a tel: link", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    for (const link of screen.queryAllByRole("link")) {
      expect(link.getAttribute("href") ?? "").not.toMatch(/^tel:/);
    }
    expect(document.body.innerHTML).not.toContain("tel:");
  });

  it("says no number is held for a cleared episode, rather than rendering a blank", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);
    STORE_CLOCK.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: id },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("clear-number-plan-solo") },
    );
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    await renderPage();

    const identity = screen.getByRole("heading", { level: 2, name: PATIENT }).closest("section");
    expect(identity).not.toBeNull();
    expect(identity).toHaveTextContent("Mobile number: no number held for this episode");
    // A cleared field is "no number held", never a number and never an empty-looking gap.
    expect(identity).not.toHaveTextContent("0400000000");
  });

  it("falls back to the synthetic identifier, and says a name is not held, for a cleared episode", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);
    STORE_CLOCK.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: id },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("clear-plan-solo") },
    );
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    await renderPage();

    expect(screen.getByRole("heading", { level: 2, name: PATIENT })).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "No name is held for this patient" })).toBeInTheDocument();
  });

  it("shows the name the messages open with", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const identity = screen.getByRole("heading", { level: 2, name: "Rowan Sample" }).closest("section");
    expect(identity).toHaveTextContent("Called this in messages: Rowan");
  });

  it("tells a CLEARED preferred name apart from one that was never held", async () => {
    // Three values, three facts, and the two absences must not read as the same one. `""` is what
    // `markRetentionCleared` writes; `null` is an episode that predates the column or whose caller
    // supplied none. A screen that rendered both as one sentence would report a name a clinician
    // recorded and retention removed as a name nobody ever gave.
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);
    STORE_CLOCK.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: id },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("clear-preferred-plan-solo") },
    );
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    await renderPage();

    const identity = screen.getByRole("heading", { level: 2, name: PATIENT }).closest("section");
    expect(identity).toHaveTextContent("Called this in messages: removed when this episode was de-identified");
    // Not the name itself, and not the wording reserved for an episode that never held one.
    expect(identity).not.toHaveTextContent("Called this in messages: Rowan");
    expect(identity).not.toHaveTextContent("none is held for this episode");
  });

  it("says none is held, without naming a cause, for an episode that never had one", async () => {
    // The other side of the partition, and the reason both cases exist: a screen collapsing the two
    // would pass whichever one it was tested against alone. This fixture is one the store cannot
    // build today -- every plan it creates records a preferred name -- so the episode is handed to
    // the component directly, exactly as the suppression fixture below is.
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    const record = await store.getPlan(id, { actor: demoActorForRole("coordinator") });
    const episode = await store.getEpisode(id, { actor: demoActorForRole("coordinator") });
    if (record === null || episode === null) throw new Error("the fixture plan was not readable");

    // Positive control: the episode the store really built DOES hold one, so the sentence below is
    // the null case being rendered rather than this screen never showing a name at all.
    expect(episode.preferredName).toBe("Rowan");

    render(
      <PatientOverview
        patientId={PATIENT}
        // `episodeView` rather than a raw literal: Task 11b made `actions` a required member of the
        // episode view, and this case predates it. The default context is right here because the
        // case is about the preferred name, not about the actions.
        view={episodeView({ record, episode: { ...episode, preferredName: null }, otherPlanCount: 0 })}
      />,
    );

    const identity = screen.getByRole("heading", { level: 2, name: "Rowan Sample" }).closest("section");
    expect(identity).toHaveTextContent("Called this in messages: none is held for this episode");
    expect(identity).not.toHaveTextContent("removed when this episode was de-identified");
  });
});

/**
 * Sendability is keyed off `contact.state`, never off `planned.suppressed`.
 *
 * The two agree for every plan the STORE can currently produce, because the schedule absorbing
 * Week 1 into the first contact is the only suppression any repository write performs -- which is
 * exactly why the tests above cannot tell the derivations apart, and why swapping one for the
 * other left them all green. `applyContactTransition`'s `suppress` action moves any live contact
 * to `suppressed` and leaves `planned.suppressed` undefined; no store method calls it yet, and the
 * screen must already be right for the day one does. This is the same defect Task 5's finding N-2
 * named on the caseload row, one screen further along.
 *
 * The component is rendered directly here rather than through the page, because the fixture is one
 * the store cannot build. That is the whole point of it.
 */
describe("the patient overview - a contact suppressed by a later transition still counts", () => {
  const TEAM = demoActorForRole("coordinator").teamId;

  function entry(sequence: number, state: ContactState, options: { absorbed?: boolean } = {}): StoredContact {
    return {
      contact: { id: contactId(`plan-x--contact-${sequence}`), planId: planId("plan-x"), state, version: 1 },
      planned: {
        sequence,
        cadenceLabel: sequence === 1 ? "Day 1" : `Month ${sequence}`,
        calendarDay: `2026-0${sequence}-01`,
        sendAt: new Date(`2026-0${sequence}-01T02:00:00.000Z`),
        messageType: sequence === 1 ? "first" : "standard",
        ...(options.absorbed === true ? { suppressed: { reason: "absorbedByFirstContact" as const } } : {}),
      },
    };
  }

  const record: PlanRecord = {
    plan: { id: planId("plan-x"), teamId: TEAM, state: "active", version: 1 },
    mobileCheck: { state: "notChecked", sentAt: null, resolvedAt: null },
    patientId: patientId(PATIENT),
    referralId: referralId("referral-x"),
    pathwayVersionId: pathwayVersionId("pathway-1"),
    dischargeAt: new Date("2026-08-15T02:00:00.000Z"),
    // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
    // plan's creation instant is set to the same instant as its discharge rather than invented.
    createdAt: new Date("2026-08-15T02:00:00.000Z"),
    completedAt: null,
    outcome: "inProgress",
    assuranceAttestations: [],
    // The middle entry is suppressed with NO `planned.suppressed` marker -- a later transition,
    // not the schedule's absorption.
    contacts: [entry(1, "scheduled"), entry(2, "suppressed"), entry(3, "scheduled")],
  };

  it("subtracts it from the count, and explains it as the cause this screen does not hold", () => {
    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "3 entries: 2 still to send, and 1 that will not be sent.",
    );
    const suppressed = screen.getByRole("group", { name: "Suppressed" });
    // Not the absorption wording: nothing here says this message collided with the first contact,
    // because nothing on this screen knows that it did.
    expect(suppressed).toHaveTextContent(/does not hold what caused that/i);
    expect(suppressed).not.toHaveTextContent(/same calendar day/i);
    expect(suppressed).toHaveTextContent(/never sent later/i);
  });
});

/**
 * C1, review round 1. The summary said "every one of them will be sent" for any plan holding no
 * SUPPRESSED contact -- so a withdrawn plan, or one stopped by a recorded death, announced ten
 * cancelled messages as ten messages still to come, directly above ten rows each reading
 * "Caring contact · Cancelled". On a suicide-prevention screen.
 *
 * Both plans are built through the real store, because both are reached by ordinary writes:
 * `withdrawPlan` and `recordHospitalStatusEvent`'s `cancelUnsent` outcome each run every unsent
 * contact through `{ type: "cancel" }`. Nothing here is a hand-built fixture, so nothing here can
 * be true of a plan the domain would never produce.
 */
describe("the patient overview - a plan that has ended says so, and never promises a send", () => {
  it("says none of a withdrawn plan's messages will be sent", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);

    await renderPage();

    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries, and none of them will be sent.",
    );
    // The old predicate's exact failure, pinned as the sentence it used to print: not one of
    // these contacts is suppressed, and every one of them is non-sendable.
    expect(screen.getByTestId("caring-contacts-schedule-summary")).not.toHaveTextContent(
      "every one of them will be sent",
    );
    expect(screen.getByTestId("caring-contacts-schedule-summary")).not.toHaveTextContent("still to");
  });

  it("says none of a death-stopped plan's messages will be sent", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await recordDeath(store, id);

    await renderPage();

    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries, and none of them will be sent.",
    );
  });

  it("explains every cancelled message in place, rather than leaving a bare status beside it", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);

    await renderPage();

    // Spec 4.4: one explanation per row, not one for the screen. Ruling 98 named only suppression;
    // a cancellation is equally the system having acted on its own.
    const cancelled = screen.getAllByRole("group", { name: "Cancelled" });
    expect(cancelled).toHaveLength(10);
    expect(cancelled[0]).toHaveTextContent(/This plan ended \(withdrawn\)/i);
    expect(cancelled[0]).toHaveTextContent(/cancelled every message that had not already gone out/i);
    expect(cancelled[0]).toHaveTextContent(/never sent later/i);
    // An ended plan has no "messages that remain" to continue with.
    expect(cancelled[0]).toHaveTextContent(/this plan has ended, so it sends no further messages/i);
    expect(cancelled[0]).not.toHaveTextContent(/continues with the messages that remain/i);
  });

  it("offers no Hold, withdrawal or move on a plan that has ended, and says why", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);

    await renderPage();

    const card = screen.getByTestId("caring-contacts-plan-actions");
    expect(within(card).getByTestId("caring-contacts-plan-actions-ended")).toHaveTextContent(
      /This plan has ended, so no plan action applies to it/,
    );
    expect(
      within(card).queryByRole("button", { name: /Hold this plan|Record a withdrawal|Move this plan/ }),
    ).toBeNull();
  });

  it("does not claim a plan still running ended, when one of its messages is cancelled", () => {
    const record: PlanRecord = {
      plan: { id: planId("plan-x"), teamId: demoActorForRole("coordinator").teamId, state: "active", version: 1 },
      mobileCheck: { state: "notChecked", sentAt: null, resolvedAt: null },
      patientId: patientId(PATIENT),
      referralId: referralId("referral-x"),
      pathwayVersionId: pathwayVersionId("pathway-1"),
      dischargeAt: new Date("2026-08-15T02:00:00.000Z"),
      // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
      // plan's creation instant is set to the same instant as its discharge rather than invented.
      createdAt: new Date("2026-08-15T02:00:00.000Z"),
      completedAt: null,
      outcome: "inProgress",
      assuranceAttestations: [],
      contacts: [
        {
          contact: { id: contactId("plan-x--contact-1"), planId: planId("plan-x"), state: "cancelled", version: 1 },
          planned: {
            sequence: 1,
            cadenceLabel: "Day 1",
            calendarDay: "2026-08-16",
            sendAt: new Date("2026-08-16T02:00:00.000Z"),
            messageType: "first",
          },
        },
      ],
    };

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    const cancelled = screen.getByRole("group", { name: "Cancelled" });
    expect(cancelled).toHaveTextContent(/does not hold what caused that/i);
    expect(cancelled).not.toHaveTextContent(/This plan ended/i);
  });

  it("explains a missed message as a closed window, not as a send still to come", () => {
    const record: PlanRecord = {
      plan: { id: planId("plan-x"), teamId: demoActorForRole("coordinator").teamId, state: "active", version: 1 },
      mobileCheck: { state: "notChecked", sentAt: null, resolvedAt: null },
      patientId: patientId(PATIENT),
      referralId: referralId("referral-x"),
      pathwayVersionId: pathwayVersionId("pathway-1"),
      dischargeAt: new Date("2026-08-15T02:00:00.000Z"),
      // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
      // plan's creation instant is set to the same instant as its discharge rather than invented.
      createdAt: new Date("2026-08-15T02:00:00.000Z"),
      completedAt: null,
      outcome: "inProgress",
      assuranceAttestations: [],
      contacts: [
        {
          contact: { id: contactId("plan-x--contact-1"), planId: planId("plan-x"), state: "missed", version: 1 },
          planned: {
            sequence: 1,
            cadenceLabel: "Day 1",
            calendarDay: "2026-08-16",
            sendAt: new Date("2026-08-16T02:00:00.000Z"),
            messageType: "first",
          },
        },
        {
          contact: { id: contactId("plan-x--contact-2"), planId: planId("plan-x"), state: "delivered", version: 1 },
          planned: {
            sequence: 2,
            cadenceLabel: "Month 1",
            calendarDay: "2026-09-15",
            sendAt: new Date("2026-09-15T02:00:00.000Z"),
            messageType: "standard",
          },
        },
        {
          contact: { id: contactId("plan-x--contact-3"), planId: planId("plan-x"), state: "scheduled", version: 1 },
          planned: {
            sequence: 3,
            cadenceLabel: "Month 2",
            calendarDay: "2026-10-15",
            sendAt: new Date("2026-10-15T02:00:00.000Z"),
            messageType: "standard",
          },
        },
      ],
    };

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    // All three buckets at once -- the only shape that proves the sentence is built from the
    // summary rather than from the absence of one state.
    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "3 entries: 1 already sent, 1 still to send, and 1 that will not be sent.",
    );
    expect(screen.getByRole("group", { name: "Missed" })).toHaveTextContent(/window for sending this message closed/i);
  });
});

/**
 * Fixture helpers for the Task 10 blocks below.
 *
 * Hand-built rather than driven through the store, and only where the case CANNOT be reached
 * through one: a plan holding no attestation is a row created before the attestation existed, and
 * `createPlan` refuses an empty assurance list by name, so no store can produce one now. The
 * schedule shape is likewise not the subject of those blocks -- the store-driven blocks above own
 * that -- so a two-entry schedule keeps each assertion pointed at the one thing it is about.
 *
 * Every store-reachable case in this file's Task 10 blocks still goes through the real store.
 */
const FIXTURE_TEAM = demoActorForRole("coordinator").teamId;
const FIXTURE_PLAN = "plan-fixture";

function attestationFixture(assurance: PlanAssurance): PlanAssuranceAttestation {
  return { assurance, actorId: actorId("demo-coordinator"), attestedAt: new Date(NOW) };
}

function scheduleEntryFixture(
  sequence: number,
  state: ContactState,
  options: { cadenceLabel?: string; messageType?: MessageType } = {},
): StoredContact {
  return {
    contact: {
      id: contactId(`${FIXTURE_PLAN}--contact-${sequence}`),
      planId: planId(FIXTURE_PLAN),
      state,
      version: 1,
    },
    planned: {
      sequence,
      cadenceLabel: options.cadenceLabel ?? `Month ${sequence}`,
      calendarDay: `2026-0${sequence}-01`,
      sendAt: new Date(`2026-0${sequence}-01T02:00:00.000Z`),
      messageType: options.messageType ?? "standard",
    },
  };
}

/** The same plan, held in each of the two states that are not running. */
function pausedPlanFixture(): PlanRecord["plan"] {
  return { id: planId(FIXTURE_PLAN), teamId: FIXTURE_TEAM, state: "paused", version: 1 };
}

function draftPlanFixture(): PlanRecord["plan"] {
  return { id: planId(FIXTURE_PLAN), teamId: FIXTURE_TEAM, state: "draft", version: 1 };
}

/**
 * The plan-actions context a hand-built episode view is given when a case is not about the actions.
 *
 * DELIBERATELY THE PERMITTED, RUNNING, CARRIED SHAPE -- the one where every control is live. A
 * fixture that refused everything would let a case about some other part of the screen pass while
 * the actions rendered nothing at all, which is the vacuous-fixture failure this file already
 * guards against elsewhere. The cases that are about the actions build their own context or go
 * through the page.
 */
function planActionsFixture(overrides: Partial<PlanActionsContext> = {}): PlanActionsContext {
  return {
    planId: FIXTURE_PLAN,
    planState: "active",
    planVersion: 1,
    actingAccount: "coordinator",
    actingAccountWording: CARING_CONTACT_ROLE_WORDING.coordinator,
    actingActorId: "demo-coordinator",
    carriedBy: { actorId: "demo-coordinator", wording: CARING_CONTACT_ROLE_WORDING.coordinator },
    destinations: [{ actorId: "demo-teamLead", wording: CARING_CONTACT_ROLE_WORDING.teamLead }],
    granted: { pause: true, resume: true, withdrawal: true, reassignment: true, cancelDraft: true, claim: true },
    ...overrides,
  };
}

/** An episode view, with the plan-actions context defaulted for the cases that are not about it. */
function episodeView(
  view: Omit<Extract<PatientOverviewView, { kind: "episode" }>, "kind" | "actions"> & {
    actions?: PlanActionsContext;
  },
): PatientOverviewView {
  const { actions, ...rest } = view;
  return {
    kind: "episode",
    ...rest,
    actions:
      actions ?? planActionsFixture({ planState: rest.record.plan.state, planVersion: rest.record.plan.version }),
  };
}

function planRecordFixture(overrides: Partial<PlanRecord> = {}): PlanRecord {
  return {
    plan: { id: planId(FIXTURE_PLAN), teamId: FIXTURE_TEAM, state: "active", version: 1 },
    mobileCheck: { state: "notChecked", sentAt: null, resolvedAt: null },
    patientId: patientId(PATIENT),
    referralId: referralId("referral-fixture"),
    pathwayVersionId: pathwayVersionId("pathway-1"),
    dischargeAt: DISCHARGE,
    // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
    // plan's creation instant is set to the same instant as its discharge rather than invented.
    createdAt: DISCHARGE,
    completedAt: null,
    outcome: "inProgress",
    assuranceAttestations: PLAN_ASSURANCE_VALUES.map(attestationFixture),
    contacts: [
      scheduleEntryFixture(1, "scheduled", { cadenceLabel: "Day 1", messageType: "first" }),
      scheduleEntryFixture(2, "scheduled"),
    ],
    ...overrides,
  };
}

/**
 * Task 10. The plan detail screen is this screen DEEPENED, not a second one (Ruling [128]):
 * `/caring-contacts/patients/[patientId]?plan=<planId>` already exists, `patientPlanRoute()` builds
 * it, and `CARING_CONTACTS_ROUTES` carries no key for a standalone plan page. So everything below
 * asserts against the same render the blocks above use.
 *
 * THE DEFECT THIS BLOCK IS WRITTEN FIRST FOR. A plan that is not RUNNING still holds contacts in
 * `scheduled`, because `pausePlan` is a plain lifecycle transition -- it moves the plan and touches
 * no contact -- so `contactSendability` classifies every one of them `stillToSend` and the summary
 * sentence above reads "every one of them is still to be sent". On a paused plan that sentence is
 * about the RECORD and reads as a promise about the future. The withdrawn and death-stopped plans
 * covered above are the case the domain already closes for itself (both cancel every unsent
 * contact); paused and draft are the two it does not, and they are where this screen could
 * reintroduce the "a stopped plan would still send" defect.
 */
describe("the patient overview - a plan that is not running must not read as forthcoming", () => {
  it("says a PAUSED plan is not running, and that a date below is not a message on its way", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    const actor = demoActorForRole("coordinator");
    const activated = await store.activatePlan(
      { planId: id, expectedVersion: 1 },
      { actor, idempotencyKey: idempotencyKey("activate-pause") },
    );
    if (!activated.ok) throw new Error(`activatePlan refused: ${activated.reason}`);
    const paused = await store.pausePlan(
      { planId: id, expectedVersion: activated.value.plan.version },
      { actor, idempotencyKey: idempotencyKey("pause-plan-solo") },
    );
    if (!paused.ok) throw new Error(`pausePlan refused: ${paused.reason}`);

    await renderPage();

    // The domain's own classification is unchanged and is still reported honestly: pausing moved
    // the plan, not the contacts.
    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries, and every one of them is still to be sent.",
    );
    // And the qualification that stops that sentence reading as a promise.
    const note = screen.getByRole("group", { name: "Paused" });
    expect(note).toHaveTextContent("this plan is paused");
    expect(note).toHaveTextContent("a date below is not a message on its way");
    // The remedy names a control that now EXISTS on this screen (Task 11b). It used to say there
    // was none, and that sentence was true when it was written and false the moment the plan
    // actions landed -- a remedy that points at nothing is worse than no remedy at all.
    expect(note).toHaveTextContent(/Letting the plan run again/i);
    expect(note, "the note still says this screen offers no way to lift a hold").not.toHaveTextContent(
      /no control for that on this screen/i,
    );
    expect(screen.getByTestId("caring-contacts-plan-action-resume")).toBeInTheDocument();
  });

  it("says a DRAFT plan has not been started, in different words from the paused one", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const note = screen.getByRole("group", { name: "Draft" });
    expect(note).toHaveTextContent("this plan has not been started");
    expect(note).toHaveTextContent("a date below is not a message on its way");
  });

  it("does not let draft and paused collapse into one note, and proves the locators first", () => {
    // REVIEW ROUND 2. These two negatives used to sit at the end of the case above, behind
    // `getByRole("group", { name: "Draft" })` -- and the mutation aimed at them (M6, the draft label
    // swapped for the paused one) makes THAT line fail first, so neither negative was ever reached.
    // A sibling that fails first does not prove the assertion behind it. They live in their own case
    // now, each preceded by the positive control that shows its locator can find what it is denying.
    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({
          record: planRecordFixture({ plan: pausedPlanFixture() }),
          episode: null,
          otherPlanCount: 0,
        })}
      />,
    );
    // Positive control: both locators DO find a paused note when the plan is paused.
    expect(screen.getByRole("group", { name: "Paused" })).toHaveTextContent(/paused/i);
    cleanup();

    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({
          record: planRecordFixture({ plan: draftPlanFixture() }),
          episode: null,
          otherPlanCount: 0,
        })}
      />,
    );
    // The group negative FIRST, so a mutated label reaches it rather than failing the line above it.
    expect(screen.queryByRole("group", { name: "Paused" })).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Draft" })).not.toHaveTextContent(/paused/i);
  });

  it("adds no such note to a running plan, so the note means something when it appears", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    const activated = await store.activatePlan(
      { planId: id, expectedVersion: 1 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("activate-running") },
    );
    if (!activated.ok) throw new Error(`activatePlan refused: ${activated.reason}`);

    // Positive control first (review round 2): the same locator DOES find a not-running note when
    // the plan is not running, so the two absences below are the plan's state rather than a query
    // that never matches anything.
    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({
          record: planRecordFixture({ plan: draftPlanFixture() }),
          episode: null,
          otherPlanCount: 0,
        })}
      />,
    );
    expect(screen.getByRole("group", { name: "Draft" })).toBeInTheDocument();
    cleanup();

    await renderPage();

    expect(screen.getByTestId("caring-contacts-plan-summary")).toHaveTextContent("Plan state: Active");
    expect(screen.queryByRole("group", { name: "Draft" })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Paused" })).not.toBeInTheDocument();
  });

  it("adds no plan-level note to an ENDED plan, which already explains itself row by row", async () => {
    // The `stillToSend === 0` guard, which would otherwise be an unproven check. `withdrawPlan`
    // cancels every unsent contact, so a withdrawn plan has nothing that could read as forthcoming
    // and `notSentExplanation` has already given each row its own reason. A second, plan-level
    // sentence over the top of ten explained rows would be the screen saying the same thing twice
    // in different words -- and the branch it would come from says the record disagrees with
    // itself, which about a withdrawn plan would be false.
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);

    await renderPage();

    expect(screen.getByTestId("caring-contacts-schedule-summary")).toHaveTextContent(
      "10 entries, and none of them will be sent.",
    );
    expect(screen.queryByRole("group", { name: "Withdrawn" })).not.toBeInTheDocument();
    // The rows still carry their own reason, so nothing was lost by withholding the note -- and this
    // is the positive control for the absence above: the same `getByRole("group", { name })` locator
    // finds plenty here, so "no Withdrawn group" is the screen's answer, not a query that matches
    // nothing. Held to expected CONTENT rather than to a count greater than zero (review round 2),
    // because a count is satisfied by a group carrying any words at all.
    const cancelled = screen.getAllByRole("group", { name: "Cancelled" });
    expect(cancelled[0]).toHaveTextContent(
      "This plan ended (withdrawn), and the system cancelled every message that had not already gone out.",
    );
  });
});

/**
 * The two stored fields whose retention rules are deliberate OPPOSITES, on the first screen that
 * renders both.
 *
 * Ruling [105]: the first-contact reason is CLEARED, because it is clinician prose that will name
 * patients and places. Ruling [122]: the attestation is PRESERVED, because it is
 * `{ assurance, actorId, instant }` -- no patient content -- and is the same class as an audit
 * event, which de-identification deliberately keeps.
 *
 * The third case is the one that makes the pair visible at all: one cleared plan, rendered once,
 * where the reason is gone and the attestation is still there. A test that only proved each field
 * separately would pass against a screen that quietly rendered neither.
 */
describe("the patient overview - the attestation is recorded on the plan, and is not consent", () => {
  it("reads both attestations back in plain words, and never says the patient consented", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    const card = screen.getByRole("region", { name: "What was confirmed before this plan started" });
    // HELD TO EXPECTED CONTENT, not to `planAssuranceWording`'s own return value. Asserting the
    // rendered text against the same function that produced it is the shape Task 9b's mutation
    // falsified: emptying the map would move both sides together and the assertion would agree with
    // itself. The literals are here, and the map is pinned to them separately below, so a change to
    // either has to be made in two places by somebody who meant it.
    expect(card).toHaveTextContent("A coordinator confirmed that the patient had agreed to receive caring contacts");
    expect(card).toHaveTextContent("that the mobile number this plan uses is the patient's own");
    expect(planAssuranceWording(PLAN_ASSURANCES.patientAgreementConfirmed)).toBe(
      "that the patient had agreed to receive caring contacts",
    );
    expect(planAssuranceWording(PLAN_ASSURANCES.patientControlsMobileConfirmed)).toBe(
      "that the mobile number this plan uses is the patient's own",
    );

    // "Recorded on the plan" survives; "stored", "kept" and "recorded" alone do not -- this system
    // distinguishes held in a tab's storage from written onto the plan, ordinary English does not.
    // Asserted on the LIST rather than the card, so the claim is pinned where each attestation is
    // read back and not satisfied by the paragraph above it.
    const list = within(card).getByRole("list", { name: "Confirmations recorded on this plan" });
    expect(list).toHaveTextContent(/recorded on the plan on/i);
    // The instant is part of what an attestation is; a row without it is not one.
    expect(list).toHaveTextContent("2026-03-02 (AWST)");
    // The claim the design's `Agreement confirmed: Yes` makes, and the one this domain cannot back.
    expect(card).not.toHaveTextContent(/consent/i);
    expect(card).toHaveTextContent(/hospital record/i);
  });

  it("says a plan created before the attestation existed holds none, rather than rendering a blank", () => {
    // No backfill, on purpose: writing a placeholder would fabricate a clinical record. So the
    // emptiness is a fact to be stated, and a screen that showed nothing at all would leave a
    // reader to conclude nobody confirmed anything.
    // Positive control first (review round 2): on a plan that HOLDS attestations, both the list
    // locator and the wording below are found. Without it, the two absence assertions would agree
    // just as happily with a card that never renders a list under any circumstances.
    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({ record: planRecordFixture(), episode: null, otherPlanCount: 0 })}
      />,
    );
    const populated = screen.getByRole("region", { name: "What was confirmed before this plan started" });
    expect(within(populated).getByRole("list", { name: "Confirmations recorded on this plan" })).toBeInTheDocument();
    expect(populated).toHaveTextContent("that the patient had agreed to receive caring contacts");
    cleanup();

    const record = planRecordFixture({ assuranceAttestations: [] });

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    const card = screen.getByRole("region", { name: "What was confirmed before this plan started" });
    expect(card).toHaveTextContent(/holds no record of those confirmations/i);
    expect(card).toHaveTextContent(/before this plan began recording them/i);
    expect(card).not.toHaveTextContent("that the patient had agreed to receive caring contacts");
    expect(within(card).queryByRole("list", { name: "Confirmations recorded on this plan" })).not.toBeInTheDocument();
  });

  it("keeps the attestation on a cleared plan while the first-contact reason has gone", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo", {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Patient was interstate for the first week.",
    });
    await endPlan(store, id);
    STORE_CLOCK.advanceYears(7);
    const cleared = await store.markRetentionCleared(
      { planId: id },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("clear-plan-solo") },
    );
    if (!cleared.ok) throw new Error(`markRetentionCleared refused: ${cleared.reason}`);

    await renderPage();

    // Cleared: the prose a clinician wrote is gone, and the screen says WHICH absence it is.
    const reason = screen.getByRole("note", { name: "First contact moved from the usual day" });
    expect(reason).not.toHaveTextContent("Patient was interstate for the first week.");
    expect(reason).toHaveTextContent(/retention clearance has since removed it/i);

    // Preserved: same render, same plan. Held to expected content for the reason the first case
    // records -- a cleared plan whose attestation had ALSO gone would agree with a screen that
    // rendered neither.
    const card = screen.getByRole("region", { name: "What was confirmed before this plan started" });
    expect(card).toHaveTextContent("A coordinator confirmed that the patient had agreed to receive caring contacts");
    expect(card).toHaveTextContent(/no patient detail/i);
  });
});

/**
 * `delivery-detail`'s inbound path (`docs/caring-contacts/interaction-matrix.md`): full-screen stage
 * on a phone, inspection drawer on a desktop, `mutation: No`.
 *
 * The control is offered only where the domain says a message left, and it asks
 * `contactSendability` rather than listing states here -- that classification lives in ./model
 * beside the state machine that produces it, and a second copy of it on a screen is the defect
 * `summariseStoredContacts` exists to have removed once.
 */
describe("the patient overview - the delivery detail overlay is wired only where a message left", () => {
  it("offers it on a message that went out, naming the row it was opened from", () => {
    const record = planRecordFixture({
      contacts: [
        scheduleEntryFixture(1, "delivered", { cadenceLabel: "Day 1", messageType: "first" }),
        scheduleEntryFixture(2, "scheduled", { cadenceLabel: "Month 1" }),
      ],
    });

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    // FILTERED BY ROW, not counted across the screen. Task 11a added the `activation-success`
    // control to the confirmations card above, so a bare count is no longer a statement about this
    // row -- and a bare count that quietly absorbed a second row would be worse than no count.
    const triggers = screen
      .getAllByTestId("workspace-overlay-trigger")
      .filter((element) => element.getAttribute("data-overlay-trigger") === "delivery-detail");
    expect(triggers).toHaveLength(1);
    // The row appears as the control's ORIGIN, so ten of these are told apart by a reader who
    // cannot see which row each sits in.
    expect(triggers[0]).toHaveAccessibleName(/opened from the Day 1 row/);
    // And the promise itself is GENERIC, because the drawer is: `OverlayHost` takes no children and
    // renders only the row's frozen summary, so a label reading "what the phone network reported for
    // Day 1" would advertise a per-contact report that the surface it opens does not contain
    // (review round 2).
    expect(triggers[0]).toHaveAccessibleName(/^What a delivery receipt means/);
  });

  it("offers none on a plan where nothing has left yet", () => {
    const record = planRecordFixture({
      contacts: [
        scheduleEntryFixture(1, "scheduled", { cadenceLabel: "Day 1", messageType: "first" }),
        scheduleEntryFixture(2, "cancelled", { cadenceLabel: "Month 1" }),
      ],
    });

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    expect(
      screen
        .queryAllByTestId("workspace-overlay-trigger")
        .filter((element) => element.getAttribute("data-overlay-trigger") === "delivery-detail"),
    ).toHaveLength(0);
  });

  it("refuses to be the workspace's escape hatch from Ruling 87 on a row that records something", () => {
    // The guard is what separates this from the silent no-op Ruling 87 forbids: it is legitimate
    // ONLY because the row's decision is an exit and the host performs the close itself.
    expect(() => assertExitOnlyOverlayRow("delivery-detail")).not.toThrow();
    expect(() => assertExitOnlyOverlayRow("withdrawal")).toThrow(/records a decision/i);
    expect(() => assertExitOnlyOverlayRow("not-an-overlay")).toThrow(/No overlay is defined/i);
  });

  it("raises the receipt drawer through the exit route rather than a commit that records nothing", () => {
    // WHAT THIS ASSERTION USED TO BE, and why it changed. It read
    // `expect(commitRefusalFor(exitOnlyOverlayCommit("delivery-detail"))).toBeNull()` -- proving the
    // staged commit was a `record` rather than an `unavailable`, because an `unavailable` carries an
    // `every-row` refusal the host would render as an aria-disabled EXIT (the defect Ruling [90]
    // fixed). That distinction was real and the assertion was sound about the code beneath it.
    //
    // The adjudication in the build record ("The duplicate `ExitOnlyOverlayTrigger`, adjudicated")
    // deliberately removed the thing it was asserting: this control now stages NOTHING at all, so
    // there is no commit to ask `commitRefusalFor` about. A no-op `record` commit is
    // indistinguishable at the host from a screen that merely satisfied the compiler, which is the
    // shape Ruling [87] exists to make impossible; staging nothing goes through the
    // `NO_STAGED_COMMIT_REASON` / `recording-rows-only` path Ruling [90] already built, and the host
    // withholds that refusal from a row recording nothing. `tests/caring-contacts-overlay-trigger`'s
    // "a row that records nothing keeps its way out" loop proves that for every non-recording row.
    //
    // So the property moved rather than weakened, and this is where it is load-bearing: the control
    // THIS SCREEN renders takes the exit route. `data-overlay-trigger-kind` is the DOM's own record
    // of which of the two routes opened it, and only the exit-only trigger writes it.
    const record = planRecordFixture({
      contacts: [
        scheduleEntryFixture(1, "delivered", { cadenceLabel: "Day 1", messageType: "first" }),
        scheduleEntryFixture(2, "scheduled", { cadenceLabel: "Month 1" }),
      ],
    });

    render(<PatientOverview patientId={PATIENT} view={episodeView({ record, episode: null, otherPlanCount: 0 })} />);

    const triggers = screen
      .getAllByTestId("workspace-overlay-trigger")
      .filter((element) => element.getAttribute("data-overlay-trigger") === "delivery-detail");
    // The positive control for the attribute assertion below: there IS a control for this row, so a
    // green is about the route it takes rather than about an empty list.
    expect(triggers, "the receipt drawer has no inbound control on this screen").toHaveLength(1);
    expect(triggers[0]).toHaveAttribute("data-overlay-trigger-kind", "exit-only");
  });
});

/**
 * `activation-success`'s inbound path (`docs/caring-contacts/interaction-matrix.md`, "Patient
 * overview outcome"): bottom sheet on a phone, dialog on a desktop, `mutation: No`.
 *
 * WHY IT IS OFFERED ON A RUNNING PLAN AND NOWHERE ELSE. The wizard clears its draft and navigates
 * the instant both writes land, so a control rendered there would exist for the width of a
 * navigation; the frozen row puts it on this screen instead. And on a plan that is NOT running, a
 * confirmation that the plan is recorded and started would contradict `planNotRunningNote` a few
 * sections below — two statements about one fact disagreeing on one screen is the defect Task 9
 * found in the wizard's own copy.
 */
describe("the patient overview - the activation outcome is offered only while the plan is running", () => {
  it("offers it beside the confirmations on a running plan, promising only what the drawer holds", () => {
    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({ record: planRecordFixture(), episode: null, otherPlanCount: 0 })}
      />,
    );

    const card = screen.getByRole("region", { name: "What was confirmed before this plan started" });
    const triggers = within(card)
      .getAllByTestId("workspace-overlay-trigger")
      .filter((element) => element.getAttribute("data-overlay-trigger") === "activation-success");
    expect(triggers, "the activation outcome has no inbound path on a running plan").toHaveLength(1);
    // Generic, because the drawer is: `OverlayHost` takes no children and renders only the row's
    // frozen summary, so a label naming THIS plan would advertise something the surface it opens
    // does not contain. Same limit `delivery-detail` records above.
    expect(triggers[0]).toHaveAccessibleName(/^What starting a plan puts on the record/);
    expect(triggers[0].className, "the outcome control is not a production tap target").toContain("min-h-tap");
    expect(triggers[0].className).not.toContain("min-h-11");
  });

  for (const notRunning of [pausedPlanFixture(), draftPlanFixture()] as const) {
    it(`offers none on a ${notRunning.state} plan, which this screen says is not running`, () => {
      render(
        <PatientOverview
          patientId={PATIENT}
          view={episodeView({ record: planRecordFixture({ plan: notRunning }), episode: null, otherPlanCount: 0 })}
        />,
      );

      expect(
        screen
          .queryAllByTestId("workspace-overlay-trigger")
          .filter((element) => element.getAttribute("data-overlay-trigger") === "activation-success"),
      ).toHaveLength(0);
    });
  }

  it("takes the exit route, which refuses any row that records something", () => {
    // The same guard `delivery-detail` leans on, asked of this row: raising it as an exit is
    // legitimate ONLY because the row's decision is an exit and the host performs the close itself.
    expect(() => assertExitOnlyOverlayRow("activation-success")).not.toThrow();
    // And the guard still bites for the plan actions on this same screen's roadmap, so this is not
    // a universal escape hatch from Ruling 87.
    expect(() => assertExitOnlyOverlayRow("pause")).toThrow(/records a decision/i);

    // The route the control actually takes, asserted on the control rather than on the module.
    // This line replaces `commitRefusalFor(exitOnlyOverlayCommit("activation-success"))` being null,
    // which proved the staged commit was a `record` rather than an `unavailable`. The adjudication
    // recorded in the build record removed the staged commit entirely -- a no-op `record` is
    // indistinguishable at the host from a screen that merely satisfied the compiler -- so there is
    // no commit left to interrogate, and `data-overlay-trigger-kind` is the DOM's own record of
    // which of the two opening routes was used. Only the exit-only trigger writes it.
    render(
      <PatientOverview
        patientId={PATIENT}
        view={episodeView({ record: planRecordFixture(), episode: null, otherPlanCount: 0 })}
      />,
    );
    const triggers = screen
      .getAllByTestId("workspace-overlay-trigger")
      .filter((element) => element.getAttribute("data-overlay-trigger") === "activation-success");
    // Positive control for the attribute assertion: the control exists on a running plan, so a green
    // below is about its route rather than about an empty list.
    expect(triggers, "the activation outcome has no inbound control on a running plan").toHaveLength(1);
    expect(triggers[0]).toHaveAttribute("data-overlay-trigger-kind", "exit-only");
  });
});

/*
 * ===========================================================================
 * Task 11b -- `pause`, `withdrawal` and `reassignment`, the three plan actions
 * ===========================================================================
 *
 * THE THREE CONTROLS IN THIS WORKSPACE THAT STOP A SUICIDE-PREVENTION PROGRAMME FOR A PERSON, which
 * is why two of them are two-stage in the frozen matrix and why the assertions below are written
 * against the RECORD rather than against the copy.
 *
 * WHY THESE CASES DRIVE THE REAL ROUTE HANDLERS RATHER THAN A STUBBED ANSWER. Every claim this
 * block makes is about what the DOMAIN does -- pausing holds and cancels nothing, withdrawal
 * cancels everything unsent, a stale version is refused, a replayed key acts once. A stubbed
 * `fetch` would let each of those be asserted against an answer this file invented, which is the
 * self-comparison trap the standing discipline names. So `fetch` is dispatched into
 * `src/app/api/caring-contacts/**`'s own POST handlers against the SAME in-memory store the page
 * reads, and every "did it mutate?" assertion reads that store back.
 */

/** One request the screen sent, captured at the seam. */
type SentRequest = { url: string; body: Record<string, unknown> };

/**
 * `fetch`, dispatched into the real route handlers.
 *
 * `swallow` models the failure the idempotency key exists for: the service acted, and the answer
 * never arrived. The handler still runs -- that is the point -- and the rejection happens after it.
 *
 * `garble` models the OTHER degraded transport, and it is the only way this screen's `plan` becomes
 * null: the write LANDS and its answer comes back in a shape `planFromWriteAnswer` cannot read. The
 * handler still runs against the real store; only what the screen is handed back is replaced.
 */
function routeFetch(
  options: {
    swallow?: (sent: SentRequest, index: number) => boolean;
    garble?: (sent: SentRequest, index: number) => boolean;
    gate?: Promise<void>;
  } = {},
) {
  const swallow = options.swallow ?? (() => false);
  const garble = options.garble ?? (() => false);
  const sent: SentRequest[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);

    if (url === "/api/caring-contacts/session") {
      const { GET } = await import("@/app/api/caring-contacts/session/route");
      return GET();
    }

    // A write held open, so a second control can be inspected while the first is still on its way.
    if (options.gate !== undefined) await options.gate;

    const raw = typeof init?.body === "string" ? init.body : "{}";
    const record: SentRequest = { url, body: JSON.parse(raw) as Record<string, unknown> };
    const index = sent.length;
    sent.push(record);

    const request = new Request(`http://localhost${url}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: raw,
    }) as unknown as NextRequest;
    const id = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));

    let answer: Response;
    if (url.startsWith("/api/caring-contacts/plans/")) {
      const { POST } = await import("@/app/api/caring-contacts/plans/[planId]/route");
      answer = await POST(request, { params: Promise.resolve({ planId: id }) });
    } else if (url.startsWith("/api/caring-contacts/assignments/")) {
      const { POST } = await import("@/app/api/caring-contacts/assignments/[planId]/route");
      answer = await POST(request, { params: Promise.resolve({ planId: id }) });
    } else {
      throw new Error(`the plan actions asked for a URL this dispatcher does not know: ${url}`);
    }

    // The handler has already run against the real store by the time this fires, which is exactly
    // the state a lost answer leaves behind.
    if (swallow(record, index)) throw new TypeError("Failed to fetch");
    // Likewise: the write has happened, and only the shape of the answer is spoiled. `200 {}` is
    // valid JSON the screen can parse and cannot read a plan out of, which is the case
    // `planFromWriteAnswer` returns null for.
    if (garble(record, index)) {
      return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return answer;
  });
  // `sent` HOLDS WRITES ONLY, and by construction rather than by filtering: the session read
  // returns above before anything is captured, so there has never been anything here to exclude.
  // The accessor keeps its name because that is what every "how many writes?" assertion is asking,
  // and it is stated here rather than implied by a filter that removes nothing.
  return { sent, spy, writes: () => sent };
}

/** The real page plus the overlay host the shell mounts in production, as ONE tree. */
async function pageWithOverlays(patient = PATIENT): Promise<ReactElement> {
  const { default: PatientOverviewPage } = await import("@/app/caring-contacts/patients/[patientId]/page");
  const element = await PatientOverviewPage({
    params: Promise.resolve({ patientId: patient }),
    searchParams: Promise.resolve({}),
  });
  return (
    <>
      {(element as ReactElement<{ children: ReactElement }>).props.children}
      <WorkspaceOverlays />
    </>
  );
}

/** Renders that tree. */
async function renderPageWithOverlays(patient = PATIENT): Promise<ReturnType<typeof render>> {
  return render(await pageWithOverlays(patient));
}

/**
 * Asks the server for this screen again and hands the answer to the SAME mounted tree.
 *
 * This is what `router.refresh()` does in production: the server renders the screen again and React
 * reconciles it into the components already mounted, so a Client Component keeps its state and
 * receives new props. A fresh `render` would prove nothing about that -- it builds new components,
 * which hold whatever their initialisers give them.
 */
async function rereadTheScreen(view: ReturnType<typeof render>, patient = PATIENT): Promise<void> {
  view.rerender(await pageWithOverlays(patient));
}

/** The trigger for ONE row, refusing anything but exactly one -- never "the trigger on screen". */
function planActionTrigger(row: string): HTMLElement {
  const matches = screen
    .getAllByTestId("workspace-overlay-trigger")
    .filter((element) => element.getAttribute("data-overlay-trigger") === row);
  if (matches.length !== 1) {
    throw new Error(`expected exactly one ${row} trigger on screen, found ${matches.length}`);
  }
  return matches[0];
}

/** ONE action's block on the card, by the heading it carries -- never "the block on screen". */
function planActionBlock(heading: string): HTMLElement {
  const container = screen.getByRole("heading", { level: 3, name: heading }).parentElement;
  if (container === null) throw new Error(`the "${heading}" block has no container to read`);
  return container;
}

/**
 * Opens one row's confirmation and presses its decision control `stages` times.
 *
 * `withdrawal` and `reassignment` are `requiresFreshAuthentication` in the frozen table, so the host
 * commits only on the SECOND activation; `pause` commits on the first. The stage count is passed
 * rather than derived so a case that expects two and gets one fails here rather than silently.
 */
async function confirmPlanAction(user: ReturnType<typeof userEvent.setup>, row: string, stages: 1 | 2): Promise<void> {
  await user.click(planActionTrigger(row));
  for (let stage = 0; stage < stages; stage += 1) {
    await user.click(await screen.findByTestId("workspace-overlay-action"));
  }
}

/** Creates a plan through the real store and starts it, so the plan actions have something live. */
async function runningPlan(store: CaringContactRepository, id = "plan-actions"): Promise<PlanId> {
  const plan = await createPlan(store, id);
  const actor = demoActorForRole("coordinator");
  const started = await store.activatePlan(
    { planId: plan, expectedVersion: 1 },
    { actor, idempotencyKey: idempotencyKey(`activate-${id}`) },
  );
  if (!started.ok) throw new Error(`activatePlan(${id}) refused: ${started.reason}`);
  return plan;
}

/** What the store holds for one plan, as the shape every "did it mutate?" assertion compares. */
async function planShape(store: CaringContactRepository, plan: PlanId, role = "coordinator") {
  const record = await store.getPlan(plan, { actor: demoActorForRole(role as "coordinator") });
  if (record === null) throw new Error(`getPlan(${plan}) released nothing`);
  return {
    state: record.plan.state,
    version: record.plan.version,
    contacts: record.contacts.map((entry) => [entry.planned.cadenceLabel, entry.contact.state] as const),
  };
}

const outcomeRegion = () => screen.getByTestId("caring-contacts-plan-action-outcome");

describe("the plan actions - Ruling [129]: a hold is not a cancellation, and the record says so", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("holds the plan and cancels NOTHING, read back from the record rather than from the copy", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const before = await planShape(store, plan);
    routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    const after = await planShape(store, plan);
    // THE CLAIM, FIRST: not one contact moved. Held to expected content on one side, then the other
    // compared to it -- three empty lists agree perfectly, so "these agree" alone proves nothing.
    expect(before.contacts).toContainEqual(["Day 1", "scheduled"]);
    expect([...new Set(before.contacts.map(([, state]) => state))]).toEqual(["scheduled"]);
    expect(after.contacts).toEqual(before.contacts);
    // And the plan itself moved, which is what a hold is.
    expect(before.state).toBe("active");
    expect(after.state).toBe("paused");
    expect(after.version).toBe(before.version + 1);
  });

  it("withdraws by cancelling every message not already gone, which is the opposite shape", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const before = await planShape(store, plan);
    routeFetch();

    await renderPageWithOverlays();
    // Two stages: the frozen table marks this row `requiresFreshAuthentication`.
    await confirmPlanAction(user, "withdrawal", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    const after = await planShape(store, plan);
    expect(after.state).toBe("withdrawn");
    expect(after.contacts).toContainEqual(["Day 1", "cancelled"]);
    // Every one of them, and the same entries as before -- the schedule is not shortened, it is
    // moved to cancelled.
    expect([...new Set(after.contacts.map(([, state]) => state))]).toEqual(["cancelled"]);
    expect(after.contacts.map(([label]) => label)).toEqual(before.contacts.map(([label]) => label));
  });

  it("says on the screen that a hold keeps the schedule, where the frozen drawer says the opposite", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    const card = screen.getByTestId("caring-contacts-plan-actions");
    expect(card).toHaveTextContent(/keeps its whole schedule/i);
    expect(card).toHaveTextContent(/no dated message is removed, no date moves/i);
    expect(card).toHaveTextContent(/can be let run again/i);
    // THE DIALOG AND THE SCREEN NOW SAY THE SAME THING. The dialog used to say contacts inside the
    // pause are "skipped for good" while this card said the whole schedule is kept; `pausePlan`
    // changes only the plan's state, so the dialog was corrected to match the card.
    expect(overlayDefinition("pause")?.summary).toMatch(/keeps the whole schedule/i);
    expect(overlayDefinition("pause")?.summary).not.toMatch(/skipped for good/i);
    expect(card, "the screen repeated the old drawer's claim about contacts being skipped").not.toHaveTextContent(
      /skipped for good/i,
    );
  });

  it("never says a hold stopped a message going out, and says why no screen may", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    const card = screen.getByTestId("caring-contacts-plan-actions");
    // Pinned whole. The claim this replaces has been made wrongly on a screen in this programme in
    // BOTH directions, so a loose match is not enough.
    expect(card).toHaveTextContent(
      "There is no messaging provider connected to this workspace at all, so nothing any of these controls does can send a message to anybody or stop one being sent.",
    );
    // What the hold DOES change, which is a fact about the write gate rather than about a sender.
    expect(card).toHaveTextContent(/the service refuses any attempt to dispatch one of its messages/i);
  });

  /**
   * THE ONE SENTENCE THAT SAYS THE SCHEDULE IS DESTROYED RATHER THAN KEPT, on the only action here
   * that cannot be undone, and nothing read it. The pause copy is asserted three ways beside it, so
   * the property was proven where it was convenient and not where it is load-bearing -- and the
   * plausible later edit is exactly the dangerous one: making the two blocks read consistently
   * would put the hold's reassuring wording onto the withdrawal and nothing would go red. A
   * coordinator ending a person's participation in a suicide-prevention programme would be told the
   * schedule is kept when the service has just cancelled every message on it.
   */
  it("says what a withdrawal does to the schedule, in the block that offers it", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    const withdrawal = planActionBlock("Record a withdrawal the patient asked for");
    // PINNED WHOLE, because this is derived from what `withdrawPlan` does -- it runs
    // `cancelAllNonTerminalContacts` -- and a loose match would survive the sentence being softened.
    expect(withdrawal).toHaveTextContent(
      "A withdrawal ends the plan, and the service moves every message on it that had not already gone to cancelled.",
    );
    expect(withdrawal).toHaveTextContent(
      "That is the opposite of holding it: nothing is kept to come back to, and it cannot be undone.",
    );
    // AND SCOPED TO THAT BLOCK. Positive control first: the hold's reassurance is present where it
    // belongs, so the negative below is about WHERE the sentence is rather than about a phrase this
    // test invented and would never have found anywhere.
    expect(planActionBlock("Hold this plan")).toHaveTextContent(/keeps its whole schedule/i);
    expect(withdrawal, "the withdrawal block took on the hold's reassuring wording").not.toHaveTextContent(
      /keeps its whole schedule/i,
    );
    // AND THE SAME AGAIN FOR THE SECOND NEGATIVE, which had neither control nor mutation.
    //
    // PINNED TO THE HOLD'S OWN CLAUSE rather than to the loose phrase, and a mutation is what
    // forced that. The loose phrase is ALSO produced inside this block by the resume refusal's
    // heading -- "Only a plan that is being held can be let run again" (`plan-action-rules.ts`) --
    // which renders here whenever the plan is running, as it is in this fixture. A control written
    // loosely therefore passes on the refusal heading while the explanation beside it could say
    // anything at all, which is the decoration this control exists to prevent.
    expect(planActionBlock("Hold this plan")).toHaveTextContent(
      "no date moves, and the plan can be let run again from this screen",
    );
    expect(withdrawal, "the withdrawal block offered a way back from an irreversible action").not.toHaveTextContent(
      /can be let run again/i,
    );
  });

  /**
   * The card teaches HOLD rather than PAUSE throughout, for the reason the case above exists -- and
   * the one sentence a coordinator reads AFTER the action was the single place it reverted to the
   * frozen row's word. The frozen row is not edited; it is simply not quoted here.
   */
  it("announces the hold in the words the card teaches, not the frozen row's", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    // ONE NAME FOR ONE ACTION. The dialog's label, title and button all say "Hold", as this card does.
    expect(overlayDefinition("pause")?.label).toBe("Hold");
    expect(overlayDefinition("pause")?.decision).toBe("Hold this plan");
    expect(outcomeRegion()).toHaveTextContent("Hold this plan — recorded on the plan");
    expect(
      outcomeRegion().textContent ?? "",
      "the outcome reverted to the vocabulary the rest of this card replaces",
    ).not.toMatch(/pause/i);
  });
});

describe("the plan actions - a guard rejection does not mutate", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("refuses a move this role may not make, keeps the control focusable, and leaves the record alone", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    // Claimed, so `somebody-is-carrying-this-plan` is met and the ROLE is the only obstacle left.
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-coordinator") } },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("claim-guard") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    const before = await planShape(store, plan);
    const assignmentBefore = await store.getAssignment(plan, { actor: demoActorForRole("coordinator") });
    const { writes } = routeFetch();

    // A coordinator is granted pausePlan and withdrawPlan and is NOT granted reassignPlan.
    await renderPageWithOverlays();
    await user.click(planActionTrigger("reassignment"));
    const action = await screen.findByTestId("workspace-overlay-action");

    // The frozen matrix's guard-rejection shape: the surface is retained, the action keeps its tab
    // stop and carries `aria-disabled`, and the named reason is on screen.
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).not.toHaveAttribute("disabled");
    const reasonId = action.getAttribute("aria-describedby");
    expect(reasonId).not.toBeNull();
    expect(document.getElementById(reasonId!)).toHaveTextContent(
      PLAN_ACTION_CONDITION_REFUSALS["the-acting-role-holds-this-action"].heading,
    );

    await user.click(action);

    // THE CLAUSE THAT MATTERS: nothing was sent, and the record is unchanged. Both records, because
    // a reassignment could move either.
    expect(writes()).toEqual([]);
    expect(await planShape(store, plan)).toEqual(before);
    expect(await store.getAssignment(plan, { actor: demoActorForRole("coordinator") })).toEqual(assignmentBefore);
  });

  it("POSITIVE CONTROL: the same row is live for a role that is granted it, so the refusal is about the role", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-teamLead") } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("claim-control") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    routeFetch();

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await user.click(planActionTrigger("reassignment"));

    expect(await screen.findByTestId("workspace-overlay-action")).not.toHaveAttribute("aria-disabled");
  });

  it("refuses a move on a plan nobody is carrying, saying which fact that is", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store, "plan-unclaimed");
    const before = await planShape(store, plan, "teamLead");
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");

    const card = screen.getByTestId("caring-contacts-plan-actions");
    expect(card).toHaveTextContent(/nobody has taken this plan on/i);
    await user.click(planActionTrigger("reassignment"));
    const action = await screen.findByTestId("workspace-overlay-action");
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(action.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      PLAN_ACTION_CONDITION_REFUSALS["somebody-is-carrying-this-plan"].heading,
    );
    await user.click(action);

    expect(writes()).toEqual([]);
    expect(await planShape(store, plan, "teamLead")).toEqual(before);
    expect(await store.getAssignment(plan, { actor: demoActorForRole("teamLead") })).toEqual({
      ownerId: null,
      claimedAt: null,
      coveredBy: null,
      reassignmentHistory: [],
    });
  });

  it("refuses a hold on a plan that is not running, and sends nothing", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await createPlan(store, "plan-draft-actions");
    const before = await planShape(store, plan);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    const action = await screen.findByTestId("workspace-overlay-action");
    expect(action).toHaveAttribute("aria-disabled", "true");
    await user.click(action);

    expect(writes()).toEqual([]);
    expect(await planShape(store, plan)).toEqual(before);
    expect(before.state).toBe("draft");
  });
});

describe("the plan actions - the commit-time recheck actually rechecks", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("refuses a withdrawal confirmed after the acting account changed, and names that refusal", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();
    // OPEN in one account, CHANGE it, then CONFIRM -- the sequence the matrix's commit-time clause
    // is about. The role switcher is a separate surface, so this is a state another tab can move.
    await user.click(planActionTrigger("withdrawal"));
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "teamLead" } };
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent(
        PLAN_ACTION_CONDITION_REFUSALS["the-acting-account-has-not-changed"].heading,
      ),
    );
  });

  /**
   * THE CLAUSE NOBODY WRITES, ON ITS OWN, AND FIRST. The case above proves the refusal is shown and
   * named; this one proves the refused decision CHANGED NOTHING, with that assertion ahead of every
   * other so it is the one a mutation reddens rather than a sibling that fails before it is reached.
   */
  it("and that refused withdrawal reaches the service not at all, leaving the record where it was", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const before = await planShape(store, plan);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("withdrawal"));
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "teamLead" } };
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    // Settle on the outcome region having SOMETHING in it, rather than on what it says -- what it
    // says is the case above's claim, and asserting it here would put a sibling in front of this
    // one. The region itself is mounted from the first render, so its presence settles nothing.
    await waitFor(() => expect(outcomeRegion()).not.toBeEmptyDOMElement());

    expect(writes()).toEqual([]);
    expect(await planShape(store, plan)).toEqual(before);
  });

  it("POSITIVE CONTROL: the same sequence without the account changing records the withdrawal", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "withdrawal", 2);

    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));
    expect(writes()).toHaveLength(1);
    expect((await planShape(store, plan)).state).toBe("withdrawn");
  });

  it("sends the version it holds, so a plan changed while the surface was open is refused by the service", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));

    // Somebody else moves the plan while the confirmation sits open.
    const elsewhere = await store.pausePlan(
      { planId: plan, expectedVersion: 2 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("elsewhere") },
    );
    if (!elsewhere.ok) throw new Error(`the other write refused: ${elsewhere.reason}`);
    const afterTheOtherWrite = await planShape(store, plan);

    await user.click(await screen.findByTestId("workspace-overlay-action"));

    await waitFor(() => expect(outcomeRegion()).toHaveTextContent("This plan changed after this screen read it"));
    // The refused attempt changed nothing: the plan is exactly as the OTHER write left it.
    expect(await planShape(store, plan)).toEqual(afterTheOtherWrite);
  });

  it("tells a permission refusal apart from a version collision, in the words it uses", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const before = await planShape(store, plan);
    routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    // The screen believes this role may hold a plan -- it was rendered for one that may. The
    // account the SERVICE acts as changes to one that may not, and `pause` carries no account
    // check, so the write goes and the service is what refuses it.
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "clinicalProgrammeLead" } };
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    await waitFor(() =>
      expect(outcomeRegion()).toHaveTextContent("This action is not granted to the role acting here"),
    );
    const permissionWords = outcomeRegion().textContent ?? "";
    // Disjoint, deliberately: "somebody changed this plan" and "you may not do this" are different
    // facts, and a coordinator acting on a suicide-prevention plan needs to know which.
    expect(permissionWords).not.toMatch(/changed after this screen read it/i);
    expect(permissionWords).toMatch(/nothing was recorded on this plan/i);
    expect(await planShape(store, plan)).toEqual(before);
  });

  /**
   * THE OTHER DIRECTION, which the case above's title used to claim and no assertion made. What was
   * unguarded: an edit giving `stale-version` the permission remedy -- the two `changedBy` strings
   * are already near-identical in shape -- would have reddened nothing, and a coordinator could no
   * longer tell "the plan moved under this screen" from "you may not do this".
   */
  it("and the other way round: a version collision does not read like a permission refusal", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    const elsewhere = await store.pausePlan(
      { planId: plan, expectedVersion: 2 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("elsewhere-disjoint") },
    );
    if (!elsewhere.ok) throw new Error(`the other write refused: ${elsewhere.reason}`);
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    await waitFor(() => expect(outcomeRegion()).toHaveTextContent("This plan changed after this screen read it"));
    const collisionWords = outcomeRegion().textContent ?? "";
    // Positive control: the refusal really is stated in full, so the negatives below are about the
    // permission wording being absent rather than about an empty region.
    expect(collisionWords).toMatch(/nothing was recorded on this plan/i);
    expect(collisionWords).not.toMatch(/not granted to the role/i);
    expect(collisionWords).not.toMatch(/may not carry out this action/i);
    expect(collisionWords).not.toMatch(/acting in a role that is granted it/i);
  });

  it("holds the other controls while a change is on its way, so a second one cannot collide with it", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    await runningPlan(store);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    routeFetch({ gate });

    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    await user.click(await screen.findByTestId("workspace-overlay-action"));

    const resume = await screen.findByTestId("caring-contacts-plan-action-resume");
    // THE NAMED REASON IS THE LOAD-BEARING HALF, so it is what the wait is on. `aria-disabled` alone
    // would prove nothing here and the mutation ledger is what showed it: a running plan's resume
    // control is refused anyway, for being a plan nobody is holding, so that attribute is already
    // "true" before any change is on its way. Only the SENTENCE distinguishes the two.
    await waitFor(() =>
      expect(document.getElementById("caring-contacts-plan-action-resume-reason")).toHaveTextContent(
        PLAN_ACTION_CONDITION_REFUSALS["no-other-change-to-this-plan-is-on-its-way"].heading,
      ),
    );
    expect(resume).toHaveAttribute("aria-disabled", "true");
    release();
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));
  });
});

describe("the plan actions - two actions in a row from one screen", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  /**
   * THE DEFECT THIS CASE EXISTS FOR, and its absence is what hid it on a sibling branch. The version
   * arrives as a PROP, and a prop cannot change without a server render. A screen that kept sending
   * the version it was rendered with would have its SECOND action refused as `stale-version` -- and
   * the honest wording for that is that the plan moved after this screen read it, which would tell a
   * coordinator somebody else had changed a suicide-prevention plan when nobody had.
   */
  it("holds the plan and then lets it run again, sending the version the first change answered", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now being held/i));

    await user.click(screen.getByTestId("caring-contacts-plan-action-resume"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/running again/i));

    // Both changes landed, in order, and the second carried the version the FIRST answered.
    expect(writes().map((entry) => [entry.body.action, entry.body.expectedVersion])).toEqual([
      ["pause", 2],
      ["resume", 3],
    ]);
    const after = await planShape(store, plan);
    expect([after.state, after.version]).toEqual(["active", 4]);
    // A hold and its lifting leave the schedule exactly where it was.
    expect(after.contacts).toContainEqual(["Day 1", "scheduled"]);
    expect([...new Set(after.contacts.map(([, state]) => state))]).toEqual(["scheduled"]);
    // Nobody was told somebody else had touched this plan.
    expect(outcomeRegion().textContent ?? "").not.toMatch(/changed after this screen read it/i);
    // The rest of this screen was rendered before both changes, so the server is asked again.
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("the plan actions - a repeated submission does not act twice", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  /**
   * ON REASSIGNMENT, BECAUSE THAT IS WHERE A SECOND PRESS PRODUCES A SECOND RECORD. The assignment
   * route carries no `expectedVersion` at all, so nothing but the idempotency key stands between one
   * press-after-a-timeout and two moves of one patient's plan. The lifecycle writes have the version
   * guard as well; this one has only the key.
   */
  it("moves the plan once when the answer is lost and the coordinator presses again", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-teamLead") } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("claim-replay") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    // The FIRST attempt reaches the service and its answer is lost on the way back.
    routeFetch({ swallow: (_sent, index) => index === 0 });

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/did not reach the service/i));

    // The coordinator presses again, exactly as the wording invites.
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    // ONE RECORD, held to expected CONTENT rather than to a count of presses, and asserted before
    // anything about the key: a second press that moved the plan twice must redden here.
    const assignment = await store.getAssignment(plan, { actor: demoActorForRole("teamLead") });
    expect(assignment?.reassignmentHistory.map((entry) => [entry.fromActorId, entry.toActorId, entry.reason])).toEqual([
      ["demo-teamLead", "demo-coordinator", "Going on leave from Friday."],
    ]);
    expect(assignment?.ownerId).toBe("demo-coordinator");
  });

  it("carries ONE key across both attempts, which is what makes the second a replay", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-teamLead") } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("claim-replay-key") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    const { writes } = routeFetch({ swallow: (_sent, index) => index === 0 });

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/did not reach the service/i));
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    const keys = writes().map((entry) => entry.body.idempotencyKey);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(typeof keys[0]).toBe("string");
  });

  /**
   * WHICH MECHANISM REFUSES THE SECOND PRESS ONCE THE RE-READ HAS LANDED -- and it is not the key.
   *
   * `refuse()` asks for this screen again on EVERY refusal, the props that come back carry the
   * version the lost write itself produced, and the sync adopts it. A lifecycle body carrying a
   * different `expectedVersion` fingerprints differently, so the retry mints a NEW key and reaches
   * the service as a new submission rather than as a replay. What refuses it is the row's own state
   * condition, read against the state that same re-read brought back.
   *
   * Nothing else in this suite presses AFTER the refresh: the replay cases above it press inside
   * the window where nothing has come back yet, which is the window the key covers. A later reader
   * relaxing `the-plan-is-running` on the belief that the key stands behind it would be removing
   * the only guard there is in the common case.
   */
  it("refuses the press after a lost answer by the state the re-read brought back, not by the key", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    // The hold reaches the service; its answer is lost on the way back.
    routeFetch({ swallow: (_sent, index) => index === 0 });

    const view = await renderPageWithOverlays();
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/did not reach the service/i));
    // POSITIVE CONTROL: the hold LANDED. What follows is therefore a refusal about a real state
    // change rather than about a screen whose write never got anywhere.
    expect((await planShape(store, plan)).state).toBe("paused");

    // What `refuse()`'s own `router.refresh()` asks for, delivered to the same mounted tree.
    await rereadTheScreen(view);

    await user.click(planActionTrigger("pause"));
    const action = await screen.findByTestId("workspace-overlay-action");
    expect(action, "the retry after the re-read was offered rather than refused").toHaveAttribute(
      "aria-disabled",
      "true",
    );
    // PINNED AS A LITERAL, not read back out of `PLAN_ACTION_CONDITION_REFUSALS`. A mutation is
    // what forced that too: rewording that map's entry moves BOTH sides of a read-it-back
    // assertion together, so it stayed green -- it was comparing two reads of one value. The
    // literal makes this about which condition refused AND about the sentence a coordinator reads.
    expect(
      document.getElementById(action.getAttribute("aria-describedby") ?? ""),
      "the retry was refused for some reason other than the state the re-read brought back",
    ).toHaveTextContent("Only a running plan can be held");
  });
});

describe("the plan actions - no way out of the commit that says nothing", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  /** Claims one plan for a role, so `somebody-is-carrying-this-plan` is met and a move is live. */
  async function claimedBy(
    store: CaringContactRepository,
    plan: PlanId,
    role: "coordinator" | "teamLead",
    tag: string,
  ) {
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId(`demo-${role}`) } },
      { actor: demoActorForRole(role), idempotencyKey: idempotencyKey(tag) },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
  }

  /**
   * THE SILENT NO-OP THIS CASE EXISTS FOR. A reassignment deliberately does not depend on this
   * screen knowing the plan's version, because the assignment route carries none -- so a plan this
   * screen has lost track of is not a reason to refuse a move. A guard belonging to the LIFECYCLE
   * writes must not defeat that: a coordinator who presses through both stages of a two-stage
   * surface and is told nothing would leave responsibility for a discharged patient with the wrong
   * person while the screen signalled that it had moved.
   */
  it("moves a plan whose last answer could not be read, rather than closing and saying nothing", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    await claimedBy(store, plan, "teamLead", "claim-unreadable-answer");
    // The hold LANDS, and its answer comes back in a shape this screen cannot read. That is the
    // only way `plan` becomes null, and the card says so in words.
    const { writes } = routeFetch({ garble: (_sent, index) => index === 0 });

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-plan-actions")).toHaveTextContent(/not known here any more/i),
    );

    await confirmPlanAction(user, "reassignment", 2);

    // THE CLAIM: a write leaves this screen, and the screen says what happened. Never silence.
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now moves to/i));
    expect(writes().map((entry) => entry.url)).toEqual([
      `/api/caring-contacts/plans/${plan}`,
      `/api/caring-contacts/assignments/${plan}`,
    ]);
    const assignment = await store.getAssignment(plan, { actor: demoActorForRole("teamLead") });
    expect(assignment?.ownerId).toBe("demo-coordinator");
  });

  /**
   * THE REMEDY A SCREEN STATES MUST BE ONE THE SCREEN PERFORMS. `stale-version` tells a coordinator
   * to read this screen again so it holds the plan as it now stands. Nothing here re-read it: the
   * refusal path asked for no server render, and a `useState` initialiser is ignored on re-render
   * anyway -- so pressing again sent the identical body and earned the identical refusal.
   */
  it("asks for this screen again after a refusal, and holds what comes back", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    const view = await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    // Somebody else holds the plan while the confirmation sits open.
    const elsewhere = await store.pausePlan(
      { planId: plan, expectedVersion: 2 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("elsewhere-remedy") },
    );
    if (!elsewhere.ok) throw new Error(`the other write refused: ${elsewhere.reason}`);
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent("This plan changed after this screen read it"));

    // HALF ONE: the screen asks the server for itself again, which is the remedy it just stated.
    expect(mocks.router.refresh).toHaveBeenCalled();

    // HALF TWO: what comes back LANDS. The plan is now held, so the control that lifts a hold is
    // live and the version it sends is the one the other write left behind.
    await rereadTheScreen(view);
    await user.click(screen.getByTestId("caring-contacts-plan-action-resume"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/running again/i));
    expect(writes().map((entry) => [entry.body.action, entry.body.expectedVersion])).toEqual([
      ["pause", 2],
      ["resume", 3],
    ]);
  });

  /**
   * A KEY NAMES A SUBMISSION, AND A SUBMISSION IS THE ACTION AND ITS BODY. Held per action until one
   * succeeds, a key outlives the submission it was minted for: a coordinator whose write was refused
   * and who then corrects it is making a genuinely NEW submission, and the service refuses a key it
   * recorded against different answers as `idempotency-key-reused-for-a-different-write`. The remedy
   * that refusal states clears nothing, so the action could not be completed from this screen at all.
   */
  it("mints a new key for a corrected submission, so a refusal is not the end of the action", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    const view = await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    // Somebody else holds the plan and lets it run again while the confirmation sits open, so this
    // screen's version is stale AND the plan is still running when it confirms.
    const held = await store.pausePlan(
      { planId: plan, expectedVersion: 2 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("elsewhere-hold") },
    );
    if (!held.ok) throw new Error(`the other hold refused: ${held.reason}`);
    const lifted = await store.resumePlan(
      { planId: plan, expectedVersion: 3 },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("elsewhere-lift") },
    );
    if (!lifted.ok) throw new Error(`the other lift refused: ${lifted.reason}`);
    await user.click(await screen.findByTestId("workspace-overlay-action"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent("This plan changed after this screen read it"));

    // The coordinator reads the screen again, exactly as the refusal said to, and holds the plan.
    await rereadTheScreen(view);
    await confirmPlanAction(user, "pause", 1);

    // THE CLAIM: the corrected submission is carried out. A key held past its submission would be
    // refused here for a second, worse reason and the hold could never be recorded from this screen.
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));
    expect(writes().map((entry) => entry.body.expectedVersion)).toEqual([2, 4]);
    const keys = writes().map((entry) => entry.body.idempotencyKey);
    expect(keys[0]).not.toBe(keys[1]);
    expect((await planShape(store, plan)).state).toBe("paused");
  });

  /**
   * A CONDITION MUST PERFORM THE CHECK ITS NAME AND ITS REFUSAL CLAIM. `a-different-coordinator-is-
   * chosen` says the choice may not be the coordinator already carrying the plan, and the server's
   * list of destinations excludes that account -- but the choice is CLIENT state and survives the
   * screen being read again, while the list does not. `applyAssignmentAction` does not refuse a move
   * from an account to itself, so a second press appends a handover row saying the plan changed
   * hands when it did not, indistinguishable afterwards from a real one.
   */
  it("refuses a move to the coordinator now carrying the plan, saying which fact that is", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    await claimedBy(store, plan, "teamLead", "claim-same-destination");
    routeFetch();

    const view = await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now moves to/i));

    // The screen is read again and the plan has moved -- but the choice made a moment ago is still
    // held here, and it now names the coordinator carrying the plan.
    await rereadTheScreen(view);
    await user.click(planActionTrigger("reassignment"));
    const action = await screen.findByTestId("workspace-overlay-action");
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(document.getElementById(action.getAttribute("aria-describedby") ?? "")).toHaveTextContent(
      PLAN_ACTION_CONDITION_REFUSALS["a-different-coordinator-is-chosen"].heading,
    );
  });

  /** THE CLAUSE NOBODY WRITES, on its own and first, so a mutation reddens it rather than a sibling. */
  it("and that refused move appends no second handover to the record", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    await claimedBy(store, plan, "teamLead", "claim-same-destination-record");
    const { writes } = routeFetch();

    const view = await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now moves to/i));

    await rereadTheScreen(view);
    await confirmPlanAction(user, "reassignment", 2);

    const assignment = await store.getAssignment(plan, { actor: demoActorForRole("teamLead") });
    expect(assignment?.reassignmentHistory.map((entry) => [entry.fromActorId, entry.toActorId])).toEqual([
      ["demo-teamLead", "demo-coordinator"],
    ]);
    expect(writes()).toHaveLength(1);
  });

  /**
   * CLEARED WHERE THE MOVE IS RECORDED, so there is nothing live left in the window between a
   * successful move and the arrival of that move's `router.refresh()`.
   *
   * `planCarriedBy` is a PROP and cannot change until the server render lands, while the choice and
   * the note are client state. Left standing, they describe a move that has already happened: the
   * choice names the account NOW carrying the plan while the prop still names the old one, so
   * `a-different-coordinator-is-chosen` is met, every other condition is met, and the trigger is
   * live. `applyAssignmentAction` does not refuse a move from an account to itself, so a second
   * confirmation appends a handover row saying the plan changed hands when it did not -- permanent,
   * and afterwards indistinguishable from a real one. Clearing at the point of RECORDING closes
   * that without depending on the refresh arriving at all.
   */
  it("clears the chosen coordinator and the handover note when the move is recorded", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    await claimedBy(store, plan, "teamLead", "claim-clears-the-choice");
    routeFetch();

    await renderPageWithOverlays();
    const destination = screen.getByLabelText("Who this plan moves to");
    const note = screen.getByLabelText("Why this plan is changing hands");
    await user.type(note, "Going on leave from Friday.");
    await user.selectOptions(destination, "demo-coordinator");
    // POSITIVE CONTROLS, before the act rather than after it: both fields hold what the coordinator
    // put in them, so the emptiness below is what RECORDING the move did rather than what the
    // fixture was.
    expect(destination).toHaveValue("demo-coordinator");
    expect(note).toHaveValue("Going on leave from Friday.");

    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now moves to/i));

    expect(destination, "the choice that has already been acted on is still standing").toHaveValue("");
    expect(note, "the note kept with the move that has already been made is still in the field").toHaveValue("");
  });

  /**
   * THE RECORD, READ INSIDE THAT WINDOW. The case above reads the two fields; this one reads what a
   * second confirmation writes while the props still name the OLD holder.
   *
   * `rereadTheScreen` is deliberately NOT called, and what that reproduces is the STATE the defect
   * needs rather than its timing: in a browser the window closes when the move's RSC round trip
   * lands, and in jsdom it never closes at all, because `router.refresh()` is a mock that delivers
   * no props. The pair above proves the other side -- once the re-read HAS landed, the stale choice
   * equals the holder and the named condition refuses it.
   */
  it("appends no second handover when the move is confirmed again before this screen has been read back", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    await claimedBy(store, plan, "teamLead", "claim-inside-the-window");
    routeFetch();

    await renderPageWithOverlays();
    await user.type(screen.getByLabelText("Why this plan is changing hands"), "Going on leave from Friday.");
    await user.selectOptions(screen.getByLabelText("Who this plan moves to"), "demo-coordinator");
    await confirmPlanAction(user, "reassignment", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/now moves to/i));

    await confirmPlanAction(user, "reassignment", 2);

    const assignment = await store.getAssignment(plan, { actor: demoActorForRole("teamLead") });
    expect(
      assignment?.reassignmentHistory.map((entry) => [entry.fromActorId, entry.toActorId]),
      "a handover was appended for a move that had already happened, from an account to itself",
    ).toEqual([["demo-teamLead", "demo-coordinator"]]);
  });
});

describe("the plan actions - what a clinician is shown, and what never reaches them", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("names the coordinator carrying the plan and the one it would move to, in the domain's own words", async () => {
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-teamLead") } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("claim-wording") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    routeFetch();

    await renderPageWithOverlays();

    const card = screen.getByTestId("caring-contacts-plan-actions");
    // The losing side, in the sealed domain's wording. Positive control for the negative below: the
    // constant is asserted PRESENT before anything is concluded from what is absent.
    expect(card).toHaveTextContent(CARING_CONTACT_ROLE_WORDING.teamLead);
    expect(
      screen.getByRole("option", { name: `a ${CARING_CONTACT_ROLE_WORDING.coordinator} account` }),
    ).toHaveAttribute("value", "demo-coordinator");
    // And never the identifier behind either of them, IN THE WORDS A CLINICIAN READS. That scope is
    // the assertion rather than an aside: an `<option>`'s `value` is required to BE the identifier
    // -- it is what the write names -- and is asserted so four lines above. It is not rendered
    // text, and this is the only sense in which the identifier is forbidden.
    const renderedWords = card.textContent ?? "";
    expect(renderedWords, "an actor identifier reached the words a clinician reads").not.toMatch(/demo-/);
    expect(renderedWords, "a raw role identifier reached the words a clinician reads").not.toMatch(/teamLead/);
  });

  it("puts the withdrawal on a full-screen stage on a phone, where the hold is a bottom sheet", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 320 });

    await renderPageWithOverlays();
    await user.click(planActionTrigger("withdrawal"));

    const surface = await screen.findByTestId("workspace-overlay-content");
    expect(surface).toHaveAttribute("data-overlay-modality", "full-screen-stage");

    // The contrast, at the SAME width, so the assertion is about this row rather than about 320px.
    // A fresh tree rather than dismissing the first: closing unwinds a history entry through an
    // asynchronous `popstate`, and racing that would make the second assertion about timing.
    cleanup();
    clearStagedWorkspaceOverlayCommit();
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
    await renderPageWithOverlays();
    await user.click(planActionTrigger("pause"));
    expect(await screen.findByTestId("workspace-overlay-content")).toHaveAttribute(
      "data-overlay-modality",
      "bottom-sheet",
    );
  });

  it("keeps every control a production tap target and visible in forced colours", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    const card = screen.getByTestId("caring-contacts-plan-actions");
    const controls = [...card.querySelectorAll("button"), ...card.querySelectorAll("select, textarea")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.className, `${control.textContent ?? control.id} is not a production tap target`).toContain(
        "min-h-tap",
      );
      expect(control.className).not.toContain("min-h-11");
      // EVERY control THIS LOOP REACHES, the way the tap-target assertion beside it already does:
      // `controlBase` on the buttons and `fieldClass` on the select and the textarea each carry
      // their own variant, so one control standing in for the card would go on passing after either
      // of those lost it. `blockClass` carries a variant too, and it is on the block `<div>`s --
      // which this loop does not reach, so its loss is not covered here.
      expect(control.className, `${control.textContent ?? control.id} disappears in forced colours`).toContain(
        "forced-colors:",
      );
    }
  });

  /**
   * A live region created together with its first content is the pattern assistive technology is
   * least reliable about: the region has to exist BEFORE the text arrives for the change to be
   * announced rather than merely rendered. What jsdom can prove is that it is mounted and empty
   * before any action; that the announcement REACHES assistive technology it cannot prove at all,
   * and this case does not claim to.
   */
  it("mounts the region that announces an outcome before there is an outcome to announce", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    const region = screen.getByTestId("caring-contacts-plan-action-outcome");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toBeEmptyDOMElement();
  });

  /**
   * THE BARGAIN THIS SYSTEM STATES: a read that cannot be recorded does not happen. Who is carrying
   * the plan is read on the server so this card can be built, and `PlanAssignment` carries free
   * clinician text about every handover -- so replacing that audited read with a bare
   * `store.getAssignment` would release it with no access record at all, and every other assertion
   * about this card would stay green.
   */
  it("records the read of who is carrying this plan on the access trail", async () => {
    const { store, recorded } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "plan", objectId: plan, outcome: "allowed" }),
    );
    // Its own row, keyed by the plan it released -- not the plan LIST's row, which is a search
    // across every plan and says nothing about this one having been looked at.
    expect(recorded()).toContainEqual(expect.objectContaining({ kind: "search", objectType: "plan", objectId: "all" }));
  });

  it("sends nothing about the patient in a URL, and no query string at all", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { sent } = routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "pause", 1);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    expect(sent.length).toBeGreaterThan(0);
    for (const entry of sent) {
      expect(entry.url).not.toContain("?");
      expect(entry.url).not.toMatch(/Rowan/i);
      expect(entry.url).not.toContain(PATIENT);
    }
    // The one identifier that does travel is the plan's, which is synthetic and is on the screen.
    expect(sent.some((entry) => entry.url.endsWith(`/${plan}`))).toBe(true);
  });
});

describe("the plan actions - the conditions table refuses an action nobody declared", () => {
  it("throws for an id no action carries, rather than answering with an empty list", () => {
    // An empty list would make a mistyped id look identical to an action with no guard at all, and
    // all four of these mutate.
    expect(() => planActionConditions("pause")).not.toThrow();
    expect(() => planActionConditions("delivery-detail")).toThrow(/No conditions are declared/i);
  });

  /**
   * THE GUARD THAT SURVIVED ITS OWN CALLER. `planActionLabel` no longer puts a string on this
   * screen -- the card writes its own names -- and the one call left is the one `planActionCardName`
   * makes and DISCARDS, so that the frozen table is still read first and an action naming no row of
   * it still throws here. That is a real and deliberate job, and nothing was reading it: a reader
   * finding no consumer of the returned string could have removed the call and taken every other
   * assertion about this card staying green as licence.
   */
  it("still refuses an action naming no row of the frozen table, though the card writes its own names", () => {
    // POSITIVE CONTROL: the card's own word for a row that DOES exist, so the throw below is about
    // the missing row rather than about this function being broken for everything.
    expect(planActionCardName("pause")).toBe("Hold this plan");
    expect(() => planActionCardName("not-an-overlay" as PlanActionId)).toThrow(/names no row of the frozen/i);
  });
});

describe("the plan actions - a draft that never started can be cancelled, after a confirmation", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("asks first, sends nothing when the draft is kept, and cancels it when confirmed", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await createPlan(store, "draft-to-cancel");
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.click(screen.getByTestId("caring-contacts-plan-action-cancel-draft"));
    // The confirmation says what cancelling does before anything is sent.
    expect(screen.getByTestId("caring-contacts-plan-action-cancel-draft-confirmation")).toHaveTextContent(
      /never started/i,
    );
    await user.click(screen.getByTestId("caring-contacts-plan-action-cancel-draft-keep"));
    expect(writes()).toHaveLength(0);
    expect((await planShape(store, plan)).state).toBe("draft");

    await user.click(screen.getByTestId("caring-contacts-plan-action-cancel-draft"));
    await user.click(screen.getByTestId("caring-contacts-plan-action-cancel-draft-confirm"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/Cancel this draft plan — recorded on the plan/i));

    expect(writes()).toEqual([
      expect.objectContaining({ body: expect.objectContaining({ action: "cancelDraft", expectedVersion: 1 }) }),
    ]);
    const after = await planShape(store, plan);
    expect(after.state).toBe("cancelled");
    expect(after.version).toBe(2);
  });

  it("is not offered on a plan that has started", async () => {
    const { store } = spiedStore();
    await runningPlan(store);
    routeFetch();

    await renderPageWithOverlays();

    // POSITIVE CONTROL: the card rendered its actions, so the absence below is about the plan's state.
    expect(screen.getByTestId("caring-contacts-plan-actions")).toHaveTextContent("Hold this plan");
    expect(screen.queryByTestId("caring-contacts-plan-action-cancel-draft")).toBeNull();
  });
});

describe("the plan actions - an unclaimed plan can be claimed from this screen", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("claims the plan for the account acting here, and the record says so", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.click(screen.getByTestId("caring-contacts-plan-action-claim"));
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/Claim this plan — recorded on the plan/i));

    expect(writes()).toEqual([
      expect.objectContaining({
        url: `/api/caring-contacts/assignments/${plan}`,
        body: expect.objectContaining({ action: { type: "claim", actorId: "demo-teamLead" } }),
      }),
    ]);
    const assignment = await store.getAssignment(plan, { actor: demoActorForRole("teamLead") });
    expect(assignment?.ownerId).toBe("demo-teamLead");
  });

  it("is not offered once somebody is carrying the plan", async () => {
    const { store } = spiedStore("teamLead");
    const plan = await runningPlan(store);
    const claimed = await store.applyAssignment(
      { planId: plan, action: { type: "claim", actorId: actorId("demo-teamLead") } },
      { actor: demoActorForRole("teamLead"), idempotencyKey: idempotencyKey("claim-before-render") },
    );
    if (!claimed.ok) throw new Error(`claim refused: ${claimed.reason}`);
    routeFetch();

    await renderPageWithOverlays();

    expect(screen.getByTestId("caring-contacts-plan-actions")).toHaveTextContent("Move this plan");
    expect(screen.queryByTestId("caring-contacts-plan-action-claim")).toBeNull();
  });
});

describe("the plan actions - a withdrawal can carry a short reason, typed in its dialog", () => {
  beforeEach(() => {
    clearStagedWorkspaceOverlayCommit();
    mocks.router.refresh.mockClear();
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
    window.history.pushState(null, "", `/caring-contacts/patients/${PATIENT}`);
  });

  it("records the reason typed in the withdrawal dialog, and keeps the dialog's locked wording", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await user.click(planActionTrigger("withdrawal"));
    const dialog = await screen.findByTestId("workspace-overlay-content");
    // The frozen row's wording is unchanged: the field is added beside it, not in place of it.
    expect(dialog).toHaveTextContent(overlayDefinition("withdrawal")?.summary ?? "(missing summary)");
    await user.type(within(dialog).getByLabelText(/Reason/), "Said the messages were hard to read.");
    for (let stage = 0; stage < 2; stage += 1) {
      await user.click(await screen.findByTestId("workspace-overlay-action"));
    }
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    expect(writes()).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({ action: "withdraw", reason: "Said the messages were hard to read." }),
      }),
    ]);
    const episode = await store.getEpisode(plan, { actor: demoActorForRole("teamLead") });
    expect(episode?.withdrawalReason).toBe("Said the messages were hard to read.");
  });

  it("sends no reason when the box is left empty, because the reason is optional", async () => {
    const user = userEvent.setup();
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const { writes } = routeFetch();

    await renderPageWithOverlays();
    await confirmPlanAction(user, "withdrawal", 2);
    await waitFor(() => expect(outcomeRegion()).toHaveTextContent(/recorded on the plan/i));

    expect(writes()[0]?.body).not.toHaveProperty("reason");
    expect((await planShape(store, plan)).state).toBe("withdrawn");
  });

  it("shows the recorded reason on the plan", async () => {
    const { store } = spiedStore();
    const plan = await runningPlan(store);
    const record = await store.getPlan(plan, { actor: demoActorForRole("coordinator") });
    const withdrawn = await store.withdrawPlan(
      { planId: plan, expectedVersion: record?.plan.version ?? 0, origin: "patient", reason: "Moving interstate." },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("withdraw-shown") },
    );
    if (!withdrawn.ok) throw new Error(`withdraw refused: ${withdrawn.reason}`);
    routeFetch();

    await renderPageWithOverlays();

    expect(screen.getByTestId("caring-contacts-withdrawal-reason")).toHaveTextContent("Moving interstate.");
  });
});

/**
 * "Record a change" and "Check the number" reach this screen from the PAGE, which decides them from
 * the actor. The behaviour of each surface is `caring-contacts-patient-updates.dom.test.tsx`'s; this
 * block proves only the wiring: a coordinator on a running plan is offered both, and an ended plan
 * offers neither the number check nor any edit.
 */
describe("the patient overview - recording a change and checking the number", () => {
  it("offers a coordinator both surfaces on a draft plan, with the number check not yet made", async () => {
    const { store } = spiedStore();
    await createPlan(store, "plan-solo");

    await renderPage();

    expect(screen.getByRole("heading", { name: "Record a change" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Check the number" })).toBeInTheDocument();
    expect(screen.getByTestId("caring-contacts-mobile-check-state")).toHaveTextContent("Number check: Not checked");
    // A draft cannot be held, so a readmission is not offered on one; a death still is.
    expect(screen.queryByTestId("caring-contacts-update-readmission")).toBeNull();
    expect(screen.getByTestId("caring-contacts-update-death")).toBeInTheDocument();
    expect(screen.getByLabelText("Type the mobile number again")).toBeInTheDocument();
  });

  it("offers no edit and no number check on an ended plan", async () => {
    const { store } = spiedStore();
    const id = await createPlan(store, "plan-solo");
    await endPlan(store, id);

    await renderPage();

    expect(screen.queryByRole("heading", { name: "Check the number" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Record a change" })).toBeNull();
  });
});
