// tests/caring-contacts-templates-page.dom.test.tsx
//
// Phase 2B Task 15. `/caring-contacts/templates`
// (`src/app/caring-contacts/templates/page.tsx`) -- the governed pathway versions this team holds.
//
// WHAT THIS FILE PROVES THAT THE COMPONENT TEST CANNOT
// ---------------------------------------------------
//   * the read is recorded on the access trail with the SAME identity
//     `api/caring-contacts/pathway-versions`'s `GET` records, so the trail does not grow a second
//     vocabulary for one read, and so "who read this team's governed pathway versions, and when"
//     stays one askable question;
//   * an EMPTY library is a permitted, readable, empty answer -- rendered as the empty STATE on the
//     success path, never as a missing resource, and recorded as `allowed` because an empty list IS
//     what was released;
//   * the capability is decided from the ACTOR rather than inferred from an empty list, because
//     `listPathwayVersions` answers a role holding neither governance capability with `[]`, exactly
//     as it answers a team holding nothing;
//   * every bad outcome fails closed, with nothing rendered.
//
// AND THE ONE THE BRIEF NAMES FIRST. The last block renders the page against the REAL demo seed --
// a version written, submitted, approved by two roles held by two people, and published through the
// domain's own transitions -- and requires the approval sentence to carry its provenance
// qualification. That is the whole safety point of the screen: the approvals on that record are
// structurally genuine and nobody gave them, and nothing about the shape of the record says so.
import { render, screen } from "@testing-library/react";
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

import { createDemoWorkspaceStore } from "@/lib/caring-contacts-server/demo-seed";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { PATIENT_VISIBLE_MESSAGE_TEMPLATE } from "@/lib/caring-contacts/message-copy";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { PATHWAY_VERSION_PROVENANCE_WORDING, type PathwayVersion } from "@/lib/caring-contacts/pathway-versions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

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

async function renderPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const { default: TemplatesPage } = await import("@/app/caring-contacts/templates/page");
  const element = await TemplatesPage({ searchParams: Promise.resolve(searchParams) });
  // The shell is the page's root; the library it wraps is what this file inspects. Rendering the
  // shell itself would drag `next/dynamic` and the whole workspace chrome into a test about one
  // screen's body.
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

describe("the /caring-contacts/templates page - an empty library is not a missing resource", () => {
  it("renders the empty STATE on the success path when the team holds no version, and never calls notFound()", async () => {
    emptyStoreWithSpy();

    const element = await renderPage();

    expect(element).toBeTruthy();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /no governed versions yet/i })).toBeInTheDocument();
  });

  it("records the empty list read as ALLOWED, the outcome an empty array actually earns", async () => {
    const { recorded } = emptyStoreWithSpy();

    await renderPage();

    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "view",
        objectType: "pathwayVersion",
        objectId: "all",
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
  });
});

describe("the /caring-contacts/templates page - reads", () => {
  it("uses the same access identity the pathway-versions API route already records", async () => {
    const { recorded } = emptyStoreWithSpy();

    await renderPage();

    // `{ view, pathwayVersion, "all" }` -- the identity `pathway-versions/route.ts`'s GET records,
    // and the one `plans/new/page.tsx` already reuses. A new object type here would have split the
    // trail's answer to one question across two values it cannot be asked for together.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "view", objectType: "pathwayVersion", objectId: "all", outcome: "allowed" }),
    );
    // And the service state, so the safety banner on this screen is a state that was READ.
    expect(recorded()).toContainEqual(
      expect.objectContaining({ kind: "administrative", objectType: "serviceState", outcome: "allowed" }),
    );
  });

  it("never reads a patient record - this screen holds no patient data and must ask for none", async () => {
    const { store } = emptyStoreWithSpy();
    const getEpisode = vi.spyOn(store, "getEpisode");
    const listPatientNames = vi.spyOn(store, "listPatientNames");
    // THE POSITIVE CONTROL, and on this assertion above all others. Everything below is an
    // absence, and an absence is satisfied just as well by a page that never reached this store at
    // all -- a changed mock path, a store swapped out from under the spies, a render that threw
    // early. This is the privacy claim this screen makes, so it has to carry its own proof that the
    // spied store is the one the page used.
    const listPathwayVersions = vi.spyOn(store, "listPathwayVersions");

    await renderPage();

    expect(
      listPathwayVersions,
      "the page did not read the spied store — the absences below prove nothing",
    ).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /no governed versions yet/i })).toBeInTheDocument();

    expect(getEpisode).not.toHaveBeenCalled();
    expect(listPatientNames).not.toHaveBeenCalled();
  });

  it("applies the URL lifecycle filter server-side, and says so rather than showing an empty library", async () => {
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "listPathwayVersions").mockResolvedValue([approvedVersion()]);

    await renderPage({ lifecycle: "retired" });

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: /no version in this state/i })).toBeInTheDocument();
    expect(screen.queryByText("No governed versions yet")).toBeNull();
  });

  it("decides the capability from the actor, so a role that may not read is not told the team holds nothing", async () => {
    // The auditor holds neither `authorPathwayVersion` nor `approvePathwayVersion`, so
    // `listPathwayVersions` answers `[]` -- indistinguishable from a team with no versions, on
    // purpose. The page asks the same any-of question the store asks and states which fact it is.
    const { store } = emptyStoreWithSpy("auditor");
    vi.spyOn(store, "listPathwayVersions").mockResolvedValue([]);

    await renderPage();

    expect(screen.getByRole("group", { name: /not visible in this role/i })).toBeInTheDocument();
    expect(screen.queryByText("No governed versions yet")).toBeNull();
  });
});

describe("the /caring-contacts/templates page - fails closed", () => {
  async function importPage() {
    return (await import("@/app/caring-contacts/templates/page")).default;
  }

  it("throws rather than rendering when the access trail cannot take the event", async () => {
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    const TemplatesPage = await importPage();

    await expect(TemplatesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/access trail is unavailable/i);
  });

  it("throws rather than rendering when the versions read itself fails, and still records the attempt", async () => {
    const { store, recorded } = emptyStoreWithSpy();
    vi.spyOn(store, "listPathwayVersions").mockRejectedValue(new Error("store unreachable"));

    const TemplatesPage = await importPage();

    await expect(TemplatesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("store unreachable");
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "pathwayVersion", outcome: "failed" }));
  });

  it("throws rather than inventing an empty library when the store breaks its list contract", async () => {
    // Unreachable through the real stores -- `listPathwayVersions` returns an array for every actor
    // -- which is exactly why a `?? []` here would never have been caught. It would render "No
    // governed versions yet" from an answer that was never given: a false statement about a
    // clinical governance record, on the screen whose subject is what has been approved.
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "listPathwayVersions").mockResolvedValue(null as unknown as PathwayVersion[]);

    const TemplatesPage = await importPage();

    await expect(TemplatesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(/returned no list/i);
  });
});

describe("the /caring-contacts/templates page - a seeded version's approvals are qualified", () => {
  it("renders the demo population's governed version with the provenance its record carries", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    // The REAL seed, through the repository's own methods: two approvals, two roles, two people,
    // neither of them the author, and `publish` after that. Nothing about the shape of the record
    // this produces distinguishes it from one people really approved -- which is why the snapshot
    // carries `provenance` and why this assertion is the point of the screen.
    withAccessSpy(await createDemoWorkspaceStore(fixedClock(NOW)));

    await renderPage();

    const rows = screen.getAllByRole("listitem");
    expect(rows.length).toBeGreaterThan(0);
    expect(screen.getByTestId("caring-contacts-pathway-provenance")).toHaveTextContent(
      PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
    );
    expect(rows[0].textContent).toContain("the clinical programme lead");
    expect(rows[0].textContent).toContain("the lived-experience representative");

    // RULING [127], IN THE ONE PLACE THE SPECIMEN IS ACTUALLY WITHIN REACH. Every other test in
    // this programme asserts the absence of message wording against a fixture that never held any.
    // The seed writes `PATIENT_VISIBLE_MESSAGE_TEMPLATE` into `snapshot.messageTextByType.standard`,
    // so this render is the only one where the real string is in the page's own data and could
    // reach the document -- which makes this the strongest available form of the guarantee.
    expect(document.body.textContent ?? "").not.toContain(PATIENT_VISIBLE_MESSAGE_TEMPLATE);
    // And the record still states, in plain words, that it HOLDS that wording. The two together are
    // the claim: the library says what the governance record contains and never shows it.
    expect(rows[0].textContent).toContain("Wording is held for the standard message.");
  });
});

/** One approved version, enough for the filter assertion above; the shapes are proved next door. */
function approvedVersion(): PathwayVersion {
  const actor = demoActorForRole("coordinator");
  return {
    id: "SYN-PATHWAY-001" as PathwayVersion["id"],
    teamId: actor.teamId,
    state: "approved",
    authorId: actor.id,
    approvals: [],
    publishedAt: null,
    retiredAt: null,
    retirementUrgency: null,
    snapshot: Object.freeze({
      cadenceLabels: Object.freeze(["Week 1"]),
      messageTextByType: Object.freeze({ first: "", standard: "", closing: "" }),
    }),
  };
}
