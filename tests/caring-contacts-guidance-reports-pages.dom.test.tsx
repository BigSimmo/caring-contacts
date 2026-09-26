// tests/caring-contacts-guidance-reports-pages.dom.test.tsx
//
// Phase 2B Task 19. `/caring-contacts/guidance` and `/caring-contacts/reports`, and the reach
// section's rendered states.
//
// WHAT THIS FILE PROVES THAT THE DOMAIN TEST CANNOT
// -------------------------------------------------
//   * both screens read the service state with the identity the API side records, so the safety
//     banner on each is a state that was actually read (Ruling 56);
//   * Reports reads plans and dispatch attempts with the identities `plans/route.ts` and
//     `dispatches/route.ts` already record, and reads NOTHING ELSE -- in particular no episode and
//     no patient name, on the screen that would be the most damaging place to release one;
//   * a measure its reader may not see says so, rather than showing a zero it did not earn;
//   * the reach section states that the field is not collected, and that state is DISTINGUISHABLE
//     from a breakdown over a populated field that happens to be empty. Those are different
//     statements and a careless screen renders them identically;
//   * and the inference attempt, run against the RENDERED ROWS rather than against the disclosure
//     value -- because the arithmetic a reader does is done on what is on the page.
import { render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
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
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { OperationalReports } from "@/components/caring-contacts/workspace/operational-reports";
import { createDemoWorkspaceStore } from "@/lib/caring-contacts-server/demo-seed";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { PATIENT_VISIBLE_NO_REPLY_NOTICE } from "@/lib/caring-contacts/message-copy";
import { CARING_CONTACT_ROLE_WORDING } from "@/lib/caring-contacts/permissions";
import { discloseReach, type ReachCell } from "@/lib/caring-contacts/reach-reporting";
import { REACH_REPORTING_GOVERNANCE } from "@/lib/caring-contacts/reach-reporting-governance";
import type { CaringContactRepository, PlanRecord } from "@/lib/caring-contacts/repository";

import { naiveSuppression, recoverableCategories, type ReadableCell } from "./helpers/caring-contacts-reach-inference";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";

/** Wraps a store so every access event it takes is visible, without changing what it does. */
function withAccessSpy(repository: CaringContactRepository): {
  store: CaringContactRepository;
  recorded: () => AccessRecord[];
} {
  const records: AccessRecord[] = [];
  const store: CaringContactRepository = {
    ...repository,
    async recordAccess(record: AccessRecord) {
      await repository.recordAccess(record);
      records.push(record);
    },
  };
  mocks.store.current = store;
  return { store, recorded: () => records };
}

function emptyStoreWithSpy(role = "coordinator") {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  return withAccessSpy(createInMemoryRepository(fixedClock(NOW)));
}

/**
 * Renders a page's BODY -- the children the shell wraps.
 *
 * Rendering the shell itself would drag `next/dynamic` and the whole workspace chrome into a test
 * about one screen; the shell's own behaviour is proved in
 * `tests/caring-contacts-workspace-shell.dom.test.tsx`.
 */
async function renderPageBody(page: () => Promise<{ default: () => Promise<ReactElement> }>) {
  const { default: Page } = await page();
  const element = await Page();
  render((element as ReactElement<{ children: ReactElement }>).props.children);
  return element;
}

/**
 * The two page modules, each behind a thunk with a LITERAL import specifier.
 *
 * `import(someVariable)` would defeat the alias resolution and the module graph this suite depends
 * on: Vite resolves `@/…` at transform time, so a specifier it cannot see as a string never gets
 * rewritten. Written out here once rather than at every call site.
 */
const GUIDANCE = () => import("@/app/caring-contacts/guidance/page");
const REPORTS = () => import("@/app/caring-contacts/reports/page");

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  mocks.notFound.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the /caring-contacts/guidance page", () => {
  it("renders the programme boundaries, quoting the patient wording from the domain constant", async () => {
    emptyStoreWithSpy();

    await renderPageBody(GUIDANCE);

    expect(mocks.notFound).not.toHaveBeenCalled();
    // The string is pinned to the CONSTANT rather than to a literal: patient-visible copy is
    // frozen, and a screen that retyped it would keep passing on the day the constant moved --
    // which is the day it matters, because the words a patient is told would then differ from the
    // words a clinician is shown they were told.
    expect(screen.getByTestId("caring-contacts-guidance")).toHaveTextContent(PATIENT_VISIBLE_NO_REPLY_NOTICE);
  });

  it("resolves the role from the sealed domain rather than writing a job title into a component", async () => {
    emptyStoreWithSpy();

    await renderPageBody(GUIDANCE);

    expect(screen.getByTestId("caring-contacts-guidance")).toHaveTextContent(CARING_CONTACT_ROLE_WORDING.teamLead);
  });

  it("states what Delivered is, and does not restate the design's claim about how a patient is", async () => {
    emptyStoreWithSpy();

    await renderPageBody(GUIDANCE);

    const guidance = screen.getByTestId("caring-contacts-guidance");
    expect(guidance).toHaveTextContent("transport receipt");
    // The approved design's boundary panel ends "…or the patient is safe". That word cannot be
    // written in this tree -- the interface-vocabulary scan refuses it, and the standing
    // constraints forbid slipping it past the scan's known word-boundary inversion. The
    // replacement has to say the same thing, so the absence is asserted beside the presence above
    // rather than on its own, where a blank screen would satisfy it.
    expect(guidance.textContent ?? "").not.toMatch(/\bsafe\b/i);
  });

  it("reads the service state with the identity the API route records, and reads nothing else", async () => {
    const { store, recorded } = emptyStoreWithSpy();
    // THE POSITIVE CONTROL for every absence below. An absence is satisfied just as well by a page
    // that never reached this store at all -- a changed mock path, a render that threw early -- so
    // the spied store has to carry its own proof that it is the one the page used.
    const getServiceState = vi.spyOn(store, "getServiceState");
    const listPlans = vi.spyOn(store, "listPlans");
    const getEpisode = vi.spyOn(store, "getEpisode");
    const listPatientNames = vi.spyOn(store, "listPatientNames");

    await renderPageBody(GUIDANCE);

    expect(getServiceState).toHaveBeenCalled();
    expect(listPlans).not.toHaveBeenCalled();
    expect(getEpisode).not.toHaveBeenCalled();
    expect(listPatientNames).not.toHaveBeenCalled();
    expect(recorded()).toEqual([
      expect.objectContaining({
        kind: "administrative",
        objectType: "serviceState",
        objectId: "service",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    ]);
  });

  it("throws rather than rendering guidance when the access trail cannot take the event", async () => {
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    const { default: GuidancePage } = await GUIDANCE();

    await expect(GuidancePage()).rejects.toThrow(/access trail is unavailable/i);
  });
});

describe("the /caring-contacts/reports page - what it reads", () => {
  it("uses the access identities the plans and dispatches API routes already record", async () => {
    const { recorded } = emptyStoreWithSpy();

    await renderPageBody(REPORTS);

    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "administrative", objectType: "serviceState", outcome: "allowed" }),
    );
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "plan", objectId: "all", outcome: "allowed" }),
    );
    // A dispatch attempt is a contact-level record, which is what `dispatches/route.ts` records it
    // against. A second vocabulary for one read is the harm Ruling 46 names.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "contact", objectId: "all", outcome: "allowed" }),
    );
  });

  it("records no access against a type this workspace does not have a read for", async () => {
    const { recorded } = emptyStoreWithSpy();

    await renderPageBody(REPORTS);

    // The other half of "no new member". `report` is declared and reserved for a report, and this
    // screen deliberately does not claim it: nothing stored here is a report, and recording the
    // plan read against it would make "who read this team's plans" miss a read that did release
    // plan records. Asserted rather than described, so a later edit that reaches for the catch-all
    // goes red.
    expect(
      recorded()
        .map((record) => record.objectType)
        .sort(),
    ).toEqual(["contact", "plan", "serviceState"]);
  });

  it("never reads a patient record - a reach report is the most damaging place to release one", async () => {
    const { store } = emptyStoreWithSpy();
    const listPlans = vi.spyOn(store, "listPlans");
    const getEpisode = vi.spyOn(store, "getEpisode");
    const listPatientNames = vi.spyOn(store, "listPatientNames");

    await renderPageBody(REPORTS);

    // The positive control first: the spied store IS the one the page read.
    expect(listPlans).toHaveBeenCalled();
    // `getEpisode` is the one read that releases cultural identity, which is the field spec §2.5's
    // reach report is over. This screen produces no reach figures at all, so it must not touch it.
    expect(getEpisode).not.toHaveBeenCalled();
    expect(listPatientNames).not.toHaveBeenCalled();
  });

  it("throws rather than inventing a report of zeroes when the store breaks its list contract", async () => {
    // Unreachable through the real stores -- `listPlans` returns an array for every actor -- which
    // is exactly why a `?? []` here would never have been caught. On a report, a page of zeroes
    // rendered from an answer that was never given is a page of false statements rather than one.
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue(null as unknown as PlanRecord[]);

    const { default: ReportsPage } = await REPORTS();

    await expect(ReportsPage()).rejects.toThrow(/returned no list/i);
  });

  it("throws rather than rendering when the dispatch read itself fails, and still records the attempt", async () => {
    const { store, recorded } = emptyStoreWithSpy();
    vi.spyOn(store, "listDispatches").mockRejectedValue(new Error("store unreachable"));

    const { default: ReportsPage } = await REPORTS();

    await expect(ReportsPage()).rejects.toThrow("store unreachable");
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "contact", outcome: "failed" }));
  });
});

describe("the /caring-contacts/reports page - what it says", () => {
  it("states that the reach field is not collected, and renders no breakdown of it", async () => {
    emptyStoreWithSpy();

    await renderPageBody(REPORTS);

    const reach = screen.getByTestId("caring-contacts-reach");
    expect(within(reach).getByTestId("caring-contacts-reach-not-collected")).toHaveTextContent(
      /does not record Aboriginal and Torres Strait Islander status/i,
    );
    // The distinction the brief turns on, asserted as a structure rather than as wording: a
    // breakdown with no members says "no patient is in any of these categories", and this screen
    // must not be able to be read that way. No breakdown is rendered at all.
    expect(within(reach).queryByTestId("caring-contacts-reach-breakdown")).toBeNull();
    expect(reach.textContent ?? "").not.toContain("Suppressed");
  });

  it("offers no control that would scope the reach section, so there is no second report to difference", async () => {
    emptyStoreWithSpy();

    await renderPageBody(REPORTS);

    // HALF THE CROSS-FILTER DEFENCE USED TO BE A PARAGRAPH. `reach-reporting.ts` argues that
    // differencing two reports over the same population but different scopes recovers what either
    // one suppressed, and that no per-report rule can prevent it -- so the section is unfiltered BY
    // CONSTRUCTION. That is a property of this screen, and a property nothing asserted: a later
    // task could add a team or date filter here and no gate would go red.
    //
    // This is that gate. Any interactive control inside the reach section fails it, whatever it is
    // called, because the argument does not depend on the control being labelled "filter".
    const reach = screen.getByTestId("caring-contacts-reach");
    expect(reach.querySelectorAll("a, button, select, input, textarea, form")).toHaveLength(0);
    // The positive control, so this is not an absence asserted over a region that failed to render:
    // the section IS on the page and IS saying something.
    expect(within(reach).getByTestId("caring-contacts-reach-not-collected")).toBeInTheDocument();
  });

  it("names the governance-set cell size and where it came from, sourced rather than retyped", async () => {
    emptyStoreWithSpy();

    await renderPageBody(REPORTS);

    // The value is asserted through the governance record, not against a literal: a screen that
    // retyped the number would keep passing on the day the decision moved, which is the one day it
    // matters. Its provenance travels with it, so a reader is never shown a disclosure control as
    // though it fell out of a calculation.
    const threshold = screen.getByTestId("caring-contacts-reach-threshold");
    expect(threshold).toHaveTextContent(String(REACH_REPORTING_GOVERNANCE.smallCellThreshold));
    expect(threshold).toHaveTextContent(REACH_REPORTING_GOVERNANCE.decidedBy);
    expect(threshold).toHaveTextContent(REACH_REPORTING_GOVERNANCE.decidedOn);
    // And it still says the report cannot be produced: a set threshold is not a set category list.
    expect(
      within(screen.getByTestId("caring-contacts-reach")).getByTestId("caring-contacts-reach-not-collected"),
    ).toBeInTheDocument();
  });

  it("tells a reader who may not see a measure that they may not, rather than showing a zero", async () => {
    // The auditor holds neither `viewReferral` nor `reconcileProviderDispatch`, so both reads
    // answer `[]` -- exactly as they answer a team that has nothing. A screen that only counted
    // rows would tell an auditor their team has sent nothing.
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "auditor" } };
    withAccessSpy(await createDemoWorkspaceStore(fixedClock(NOW)));

    await renderPageBody(REPORTS);

    const reports = screen.getByTestId("caring-contacts-reports");
    // Named rows rather than a whole-page text match, so the assertion says WHICH measures were
    // withheld from this reader and cannot be satisfied by the words appearing anywhere at all.
    for (const label of ["Planned in total", "Already sent", "Differences found"]) {
      expect(within(reports).getByText(label).parentElement).toHaveTextContent("Not visible to you");
    }
  });

  it("reports the seeded population's own contacts rather than a zero", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    // The REAL seed, through the repository's own methods, so the measures below are over records
    // the domain produced rather than over a fixture assembled to match them.
    withAccessSpy(await createDemoWorkspaceStore(fixedClock(NOW)));

    await renderPageBody(REPORTS);

    const reports = screen.getByTestId("caring-contacts-reports");
    expect(reports.textContent ?? "").not.toContain("Not visible to you");
    const planned = within(reports).getByText("Planned in total").parentElement;
    expect(Number(planned?.textContent?.replace("Planned in total", "").trim())).toBeGreaterThan(0);
  });
});

const THRESHOLD = 5;
const REACH_CELLS: readonly ReachCell[] = [
  { category: "Aboriginal", count: 12 },
  { category: "Torres Strait Islander", count: 2 },
  { category: "Neither", count: 9 },
];
const REACH_TOTAL = 23;

const EMPTY_REPORT = {
  plans: { total: 0, byState: [] },
  contacts: { total: 0, alreadySent: 0, stillToSend: 0, willNotBeSent: 0 },
  today: { calendarDay: "2026-03-02", stillToSend: 0, alreadySent: 0 },
} as const;

const NO_DISPATCHES = {
  attempts: 0,
  discrepancies: 0,
  resolved: 0,
  unresolved: 0,
  medianMinutesFromAttemptToResolution: null,
} as const;

function renderReach(reach: Parameters<typeof OperationalReports>[0]["reach"]) {
  render(
    <OperationalReports
      report={EMPTY_REPORT}
      dispatches={NO_DISPATCHES}
      mayViewPlans
      mayViewDispatches
      dispatchWindowDays={7}
      reach={reach}
    />,
  );
  return screen.getByTestId("caring-contacts-reach");
}

/** The rendered breakdown, read back off the page exactly as a reader would read it. */
function readableFromDom(reach: HTMLElement): ReadableCell[] {
  const rows = [...within(reach).getByTestId("caring-contacts-reach-breakdown").querySelectorAll("dt")];
  return rows.map((term) => {
    const value = term.nextElementSibling?.textContent?.trim() ?? "";
    return { category: term.textContent ?? "", count: value === "Suppressed" ? "hidden" : Number(value) };
  });
}

describe("the reach section, once there is something to disclose", () => {
  it("recovers a hidden figure from naively suppressed ROWS, which is what makes the attack real", () => {
    // The positive control for the assertion below, run through the same DOM path: the naive
    // rows are rendered and read back, so a change that broke the reader would break this first.
    const reach = renderReach({
      kind: "disclosed",
      disclosure: {
        kind: "breakdown",
        cells: naiveSuppression(REACH_CELLS, THRESHOLD).map((cell) =>
          cell.count === "hidden"
            ? { category: cell.category, disclosed: false as const }
            : { category: cell.category, disclosed: true as const, count: cell.count },
        ),
      },
    });

    expect(recoverableCategories(readableFromDom(reach), REACH_TOTAL)).toEqual(["Torres Strait Islander"]);
  });

  it("recovers nothing from the rows the real rule renders for the same data", () => {
    const reach = renderReach({ kind: "disclosed", disclosure: discloseReach(REACH_CELLS, THRESHOLD) });
    const readable = readableFromDom(reach);

    expect(readable.filter((cell) => cell.count === "hidden").length).toBeGreaterThan(1);
    expect(recoverableCategories(readable, REACH_TOTAL)).toEqual([]);
  });

  it("renders no total beside the rows, so there is not a second one to subtract from", () => {
    const reach = renderReach({ kind: "disclosed", disclosure: discloseReach(REACH_CELLS, THRESHOLD) });

    // The published figures are 12 and nothing else; a total of 23 anywhere in this section would
    // hand a reader the subtraction directly. The safety does not REST on this -- the rule assumes
    // the total is knowable from the measures above -- but printing it would be gratuitous.
    expect(reach.textContent ?? "").not.toContain(String(REACH_TOTAL));
    expect(reach).toHaveTextContent("Suppressed");
  });

  it("names the absence of a governance threshold as the reason, when that is the reason", () => {
    const reach = renderReach({
      kind: "disclosed",
      disclosure: { kind: "withheld", reason: "threshold-not-configured" },
    });

    expect(within(reach).getByTestId("caring-contacts-reach-withheld")).toHaveTextContent(
      /No minimum cell size has been set/i,
    );
    expect(within(reach).queryByTestId("caring-contacts-reach-breakdown")).toBeNull();
  });

  it("names the data as the reason when the data is the reason, which is a different fact", () => {
    const reach = renderReach({ kind: "disclosed", disclosure: { kind: "withheld", reason: "no-safe-disclosure" } });

    // A section that rendered this and the case above identically would tell a reader the wrong
    // one: one says nobody has set a rule, the other says the rule was applied and could not be
    // satisfied.
    const withheld = within(reach).getByTestId("caring-contacts-reach-withheld");
    expect(withheld).toHaveTextContent(/recoverable by arithmetic/i);
    expect(withheld.textContent ?? "").not.toMatch(/No minimum cell size has been set/i);
  });
});
