// tests/caring-contacts-patients-page.dom.test.tsx
//
// `/caring-contacts/patients` (`src/app/caring-contacts/patients/page.tsx`) -- the team's caseload.
//
// THE CONTRACT THIS FILE EXISTS FOR, and the one thing that survived the cut of Task 2:
//
//   `auditedRead` maps a `null`/`undefined` release to `denied`, and `readHandler` turns `denied`
//   into `not-found`. AN EMPTY ARRAY IS NEITHER. A team with no plans yet has a real, readable,
//   permitted, EMPTY caseload -- and an empty caseload must never present as a missing resource.
//
// That is not obvious from reading the page: `listPlans` returning `[]` and `getPlan` returning
// `null` look alike at a glance, and `handler.ts`'s own note says the access trail cannot tell
// "you may not see these" from "there are none" for a list. So the render shape is pinned here
// deliberately rather than left to a comment: empty renders the empty STATE on the success path,
// and `notFound()` is never called.
//
// Built on the same helper shape as `caring-contacts-page-access-audit.test.ts`, which pins the
// equivalent contract for the Today page's service-state read.
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  // The real `redirect` throws too, so throwing here keeps the page's control flow identical while
  // making the target inspectable.
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mockCookies[name] })),
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { pathwayVersionId, patientId, planId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { CaringContactRepository, PatientNameProjection, PlanRecord } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";

function inMemoryStoreWithSpy(role = "coordinator"): {
  store: CaringContactRepository;
  recorded: () => AccessRecord[];
} {
  mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };

  const repository = createInMemoryRepository(fixedClock(NOW));
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

/** One synthetic plan record, carrying no patient-identifying detail -- `PlanRecord`, never `Episode`. */
function planRecord(id: string): PlanRecord {
  return {
    plan: { id: planId(id), teamId: demoActorForRole("coordinator").teamId, state: "active", version: 1 },
    patientId: patientId(`patient-${id}`),
    referralId: referralId(`referral-${id}`),
    pathwayVersionId: pathwayVersionId("pathway-1"),
    dischargeAt: new Date("2026-03-01T02:00:00.000Z"),
    // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
    // plan's creation instant is set to the same instant as its discharge rather than invented.
    createdAt: new Date("2026-03-01T02:00:00.000Z"),
    completedAt: null,
    outcome: "inProgress",
    assuranceAttestations: [],
    contacts: [],
  };
}

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");
  const element = await PatientsPage({ searchParams: Promise.resolve(searchParams) });
  // The shell is the page's root; the directory it wraps is what this file inspects. Rendering
  // the shell itself would drag `next/dynamic` and the whole workspace chrome into a test about
  // one screen's body.
  render((element as ReactElement<{ children: ReactElement }>).props.children);
  return element;
}

beforeEach(() => {
  mockCookies = {};
  mocks.store.current = null;
  mocks.notFound.mockClear();
  mocks.redirect.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("the /caring-contacts/patients page - an empty caseload is not a missing resource", () => {
  it("renders the empty STATE on the success path when the team has no plans, and never calls notFound()", async () => {
    inMemoryStoreWithSpy();

    const element = await renderPage();

    expect(element).toBeTruthy();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /no patients yet/i })).toBeInTheDocument();
  });

  it("records the empty list read as ALLOWED, the outcome an empty array actually earns", async () => {
    const { recorded } = inMemoryStoreWithSpy();

    await renderPage();

    // `auditedRead` maps null/undefined to "denied"; `[]` is neither, so this must be "allowed".
    // A "denied" here would be the same defect wearing a different hat.
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "search",
        objectType: "plan",
        objectId: "all",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
  });
});

describe("the /caring-contacts/patients page - reads", () => {
  it("uses the same access identity the plans API route already records", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);

    await renderPage();

    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "plan", objectId: "all", outcome: "allowed" }),
    );
    // And the service state, so the safety banner on this screen is a state that was READ.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "administrative", objectType: "serviceState", outcome: "allowed" }),
    );
  });

  it("never reads the episode - the only read that releases a mobile number or an identifier", async () => {
    const { store } = inMemoryStoreWithSpy();
    const getEpisode = vi.spyOn(store, "getEpisode");
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);

    await renderPage();

    expect(getEpisode).not.toHaveBeenCalled();
  });

  it("lists a plan the team holds, keyed by its synthetic patient identifier", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1"), planRecord("plan-2")]);

    await renderPage();

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "patient-plan-1" })).toBeInTheDocument();
  });

  it("applies the URL state filter server-side, and says so rather than showing an empty caseload", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);

    await renderPage({ state: "paused" });

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /no patients match/i })).toBeInTheDocument();
    expect(screen.queryByText("No patients yet")).toBeNull();
  });
});

describe("the /caring-contacts/patients page - fails closed", () => {
  it("throws rather than rendering when the access trail cannot take the event", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/access trail is unavailable/i);
  });

  it("throws rather than rendering when the plans read itself fails, and still records the attempt", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockRejectedValue(new Error("store unreachable"));

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("store unreachable");
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "plan", outcome: "failed" }));
  });

  // I-4. `listPlans` returns an array for every actor by contract, so this branch is unreachable
  // through the real stores -- which is exactly why it was wrong and why nothing caught it. The
  // page originally defaulted a null release to `[]`, and the ONE path this branch exists for
  // would then have rendered "No patients yet" from an answer that was never given: a false
  // statement about a caseload, from a store that had just broken its own contract. A branch that
  // cannot run is still read, and is still copied by the next screen.
  it("throws rather than inventing an empty caseload when the store breaks its list contract", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue(null as unknown as PlanRecord[]);

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/returned no list/i);
  });

  // N-1. `auditedRead` calls a read denied on null OR undefined, but `AuditedReadResult` types
  // `released` as `T | null`, so the compiler cannot see this case and the test above could not
  // either -- it mocked `null` specifically. A `=== null` guard let `undefined` through to die on
  // `records.length` with a TypeError: still closed, still no false caseload, but the wrong branch.
  it("throws the same way when the store answers undefined rather than null", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue(undefined as unknown as PlanRecord[]);

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/returned no list/i);
  });

  it("throws rather than rendering a caseload beside a service state it could not read", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "getServiceState").mockRejectedValue(new Error("service state unreachable"));

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("service state unreachable");
  });
});

describe("the /caring-contacts/patients page - roles", () => {
  it("tells an auditor its role cannot view plans, rather than that the team has none", async () => {
    inMemoryStoreWithSpy("auditor");

    await renderPage();

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /not visible in this role/i })).toBeInTheDocument();
    expect(screen.queryByText("No patients yet")).toBeNull();
  });
});

describe("the /caring-contacts/patients page - the names-only projection (Ruling 91)", () => {
  it("reads the names through their OWN access identity, not folded into the plans read", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);

    await renderPage();

    // Its own row AND its own object type. This is the read on this page that releases patient
    // identity, and the trail must be able to ANSWER "who read patients' names, and when" -- not
    // merely to contain it. Review I-3: `patientDirectory` already carries two referral reads and
    // the trail's query surface filters on `objectType` with no `objectId` filter, so sharing that
    // type would have made the answer visible by eye and impossible to ask for.
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "search",
        objectType: "patientName",
        objectId: "all",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
    // And the plans read is still recorded separately, so the two are distinguishable.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "plan", objectId: "all", outcome: "allowed" }),
    );
  });

  it("names the row from the projection, and STILL never reads the episode", async () => {
    const { store } = inMemoryStoreWithSpy();
    const getEpisode = vi.spyOn(store, "getEpisode");
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);
    vi.spyOn(store, "listPatientNames").mockResolvedValue([{ planId: planId("plan-1"), patientName: "Jordan Nguyen" }]);

    await renderPage();

    expect(screen.getByRole("heading", { name: "Jordan Nguyen" })).toBeInTheDocument();
    // The whole point of the narrow read: the name arrives without the read that would have
    // released the mobile number, the identifiers and the ancestry alongside it.
    expect(getEpisode).not.toHaveBeenCalled();
  });

  it("decides the role notice from the ACTOR, and a coordinator with no names released gets none", async () => {
    // The wiring, at the page level: a coordinator holds `viewPatientRecord`, so even with the names
    // read returning nothing the screen must NOT claim a role restriction -- that team's episodes
    // are simply de-identified, or it holds none. Inferring the notice from an empty list would put
    // a false explanation in front of a clinician who does have access.
    const { store } = inMemoryStoreWithSpy("coordinator");
    vi.spyOn(store, "listPlans").mockResolvedValue([planRecord("plan-1")]);
    vi.spyOn(store, "listPatientNames").mockResolvedValue([]);

    await renderPage();

    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "patient-plan-1" })).toBeInTheDocument();
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("throws rather than rendering when the names read itself fails, and still records the attempt", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPatientNames").mockRejectedValue(new Error("names store unreachable"));

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("names store unreachable");
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "patientName", outcome: "failed" }));
  });

  it("throws rather than rendering a caseload from a names answer that was never given", async () => {
    // Same shape as the plans guard, and unreachable through either real store for the same reason:
    // `listPatientNames` returns an array for every actor by contract. A branch that cannot run is
    // still read, and is still copied by the next screen.
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listPatientNames").mockResolvedValue(undefined as unknown as PatientNameProjection[]);

    const { default: PatientsPage } = await import("@/app/caring-contacts/patients/page");

    await expect(PatientsPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/names read returned no list/i);
  });
});

/** The forms a dropped name could survive in an address or a record. */
function urlFormsOf(text: string): string[] {
  return [
    text,
    text.toLowerCase(),
    encodeURIComponent(text),
    encodeURIComponent(text).toLowerCase(),
    text.replace(/ /g, "+"),
    ...text.split(" "),
    ...text.toLowerCase().split(" "),
  ];
}

describe("the /caring-contacts/patients page - a bookmarked search term is removed, not merely unread", () => {
  const NAME = "Jordan Nguyen";

  // Ignoring `?q=<name>` was NOT enough, and was worse than doing nothing: `overlayUrl()` in
  // `workspace-overlays.tsx` copies every existing parameter into each history entry it pushes, so
  // an ignored name was re-written into a fresh entry every time an overlay opened. The address is
  // rewritten instead.
  it("redirects to an address that keeps the plan state and carries no part of the term", async () => {
    inMemoryStoreWithSpy();

    await expect(renderPage({ state: "active", q: NAME })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    const target = String(mocks.redirect.mock.calls[0]?.[0]);
    // Positive control on the target: the RECOGNISED parameter survived, so what follows is a
    // dropped name rather than a redirect that dropped everything.
    expect(target).toContain("state=active");
    expect(target).toContain("searchNotApplied=1");
    for (const form of urlFormsOf(NAME)) {
      expect(target, `the redirect target carries "${form}"`).not.toContain(form);
    }
  });

  it("fires on any unrecognised parameter name, not only on `q`", async () => {
    for (const key of ["q", "name", "search", "patient"]) {
      inMemoryStoreWithSpy();
      mocks.redirect.mockClear();
      await expect(renderPage({ [key]: NAME })).rejects.toThrow(/NEXT_REDIRECT/);
      expect(mocks.redirect, `?${key}= did not trigger the rewrite`).toHaveBeenCalledTimes(1);
      expect(String(mocks.redirect.mock.calls[0]?.[0])).not.toContain("Nguyen");
    }
  });

  it("keeps a deep-linked overlay while dropping the term beside it", async () => {
    inMemoryStoreWithSpy();

    await expect(renderPage({ overlay: "consent-and-withdrawal", q: NAME })).rejects.toThrow(/NEXT_REDIRECT/);

    const target = String(mocks.redirect.mock.calls[0]?.[0]);
    expect(target).toContain("overlay=consent-and-withdrawal");
    expect(target).not.toContain("Nguyen");
  });

  it("does not redirect an address it already understands, so the rewrite cannot loop", async () => {
    inMemoryStoreWithSpy();

    await renderPage({ state: "active", searchNotApplied: "1", overlay: "consent-and-withdrawal" });

    expect(mocks.redirect).not.toHaveBeenCalled();
    // ...and the notice the flag exists for is what the coordinator lands on.
    expect(screen.getByRole("note", { name: /a saved search was not applied/i })).toBeInTheDocument();
  });

  it("drops the term before any audited read, so it cannot reach an access record", async () => {
    // POSITIVE CONTROL FIRST. An ordinary render of this page records reads; without this, "no
    // record contains the name" would be satisfied by a page that records nothing at all.
    const ordinary = inMemoryStoreWithSpy();
    await renderPage({ state: "active" });
    expect(ordinary.recorded().length).toBeGreaterThan(0);

    const dropped = inMemoryStoreWithSpy();
    await expect(renderPage({ state: "active", q: NAME })).rejects.toThrow(/NEXT_REDIRECT/);

    expect(dropped.recorded()).toHaveLength(0);
    for (const form of urlFormsOf(NAME)) {
      expect(JSON.stringify(dropped.recorded())).not.toContain(form);
    }
  });
});
