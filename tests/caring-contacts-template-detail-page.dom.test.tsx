// tests/caring-contacts-template-detail-page.dom.test.tsx
//
// Phase 2B Task 16. `/caring-contacts/templates/[pathwayId]`
// (`src/app/caring-contacts/templates/[pathwayId]/page.tsx`) -- one governed pathway version.
//
// WHAT THIS FILE PROVES THAT THE COMPONENT TEST CANNOT
// ---------------------------------------------------
//   * the read is recorded on the access trail as `{ view, pathwayVersion, <the version's id> }`.
//     No new `AccessedObjectType` member: this releases the same object the library's read
//     releases, and the objectId is what distinguishes one named version from the collection --
//     which is the mechanism working as designed rather than an overload of it (Ruling 46);
//   * a URL segment that is NOT identifier-shaped is refused before the store is touched and
//     before any audit event is built. `buildAccessAuditEvent` throws on such an objectId, so a
//     page that read first would let a request switch off its own access record by carrying a
//     space;
//   * a version this team does not hold is a governance fact stated in words, recorded as
//     `denied`, and never a missing resource;
//   * the capability is decided from the ACTOR rather than inferred from a null release, because
//     `getPathwayVersion` answers "does not exist", "another team's" and "not your role" with the
//     same null on purpose;
//   * every bad outcome fails closed, with nothing rendered.
//
// AND THE ONE THE BRIEF NAMES FIRST. The last block renders the page against the REAL demo seed --
// a version written, submitted, approved by two roles held by two people, and published through
// the domain's own transitions. It requires the approval to carry its provenance qualification,
// and it requires `PATIENT_VISIBLE_MESSAGE_TEMPLATE` to render INSIDE the region that names it as the
// wording this record holds. That is the only render in this task where the real specimen is in
// the page's own data, so it is the only place either direction of the wording claim can be
// falsified.
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

import { createDemoWorkspaceStore, DEMO_SEED_PATHWAY_VERSION_ID } from "@/lib/caring-contacts-server/demo-seed";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import {
  CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
  PATIENT_VISIBLE_MESSAGE_TEMPLATE,
} from "@/lib/caring-contacts/message-copy";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  PATHWAY_VERSION_PROVENANCE_WORDING,
} from "@/lib/caring-contacts/pathway-versions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";
const HELD_ID = "SYN-PATHWAY-001";

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

async function importPage() {
  return (await import("@/app/caring-contacts/templates/[pathwayId]/page")).default;
}

async function renderPage(pathwayId: string) {
  const DetailPage = await importPage();
  const element = await DetailPage({ params: Promise.resolve({ pathwayId }) });
  // The shell is the page's root; the record it wraps is what this file inspects. Rendering the
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

describe("the template detail page refuses a segment that is not an identifier, before reading anything", () => {
  it("calls notFound() and never touches the store for a segment carrying a space", async () => {
    const { store, recorded } = emptyStoreWithSpy();
    const read = vi.spyOn(store, "getPathwayVersion");
    const serviceState = vi.spyOn(store, "getServiceState");

    const DetailPage = await importPage();

    await expect(DetailPage({ params: Promise.resolve({ pathwayId: "not an id" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
    // The point of the ordering, not a side effect of it: `buildAccessAuditEvent` throws on an
    // objectId that is not identifier-shaped, so a page that read first would turn a mistyped URL
    // into a render that recorded nothing and then failed.
    expect(read, "the store was read for a segment that names no version").not.toHaveBeenCalled();
    expect(serviceState, "the service state was read before the segment was checked").not.toHaveBeenCalled();
    expect(recorded(), "an access event was recorded for a request that never became one").toEqual([]);
  });

  it("serves a well-formed identifier this team does not hold, which is the control for the refusal above", async () => {
    // Without this, the case above would pass on a page that refused every segment. The two
    // together are the claim: the shape of the segment decides, and nothing else.
    const { store } = emptyStoreWithSpy();
    const read = vi.spyOn(store, "getPathwayVersion");

    await renderPage("SYN-PATHWAY-404");

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "No governed version with this identifier" })).toBeInTheDocument();
  });
});

describe("the template detail page records one named version, and states what it found", () => {
  it("records the read against the version's own identifier, not against the collection", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    const { recorded } = withAccessSpy(await seededStore());

    await renderPage(DEMO_SEED_PATHWAY_VERSION_ID);

    // `{ view, pathwayVersion, <id> }`. The objectType is the library's and the API route's; the
    // objectId is what makes this a different question the trail can be asked. A
    // `pathwayVersionDetail` member would name a SCREEN and split one askable question in two.
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        kind: "view",
        objectType: "pathwayVersion",
        objectId: DEMO_SEED_PATHWAY_VERSION_ID,
        outcome: "allowed",
        actorId: demoActorForRole("coordinator").id,
      }),
    );
    // And no read against the collection: this page reads one version, and a trail showing "all"
    // here would say a coordinator listed every governed record when they opened one.
    expect(recorded().some((record) => record.objectType === "pathwayVersion" && record.objectId === "all")).toBe(
      false,
    );
  });

  it("records a version this team does not hold as DENIED, and still renders a screen", async () => {
    const { recorded } = emptyStoreWithSpy();

    const element = await renderPage("SYN-PATHWAY-404");

    expect(element).toBeTruthy();
    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(recorded()).toContainEqual(
      expect.objectContaining({ objectType: "pathwayVersion", objectId: "SYN-PATHWAY-404", outcome: "denied" }),
    );
    expect(screen.getByRole("group", { name: "No governed version with this identifier" })).toBeInTheDocument();
  });

  it("decides the capability from the actor, so a role that may not read one is told that instead", async () => {
    // The auditor holds neither `authorPathwayVersion` nor `approvePathwayVersion`, so
    // `getPathwayVersion` answers null for a version that IS there. A screen inferring the fact
    // from the null release would tell an auditor this team holds no such governed record.
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "auditor" } };
    const { recorded } = withAccessSpy(await seededStore());

    await renderPage(DEMO_SEED_PATHWAY_VERSION_ID);

    expect(screen.getByRole("group", { name: "Governed versions are not visible in this role" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "No governed version with this identifier" })).toBeNull();
    // A denied read still belongs on the trail.
    expect(recorded()).toContainEqual(
      expect.objectContaining({
        objectType: "pathwayVersion",
        objectId: DEMO_SEED_PATHWAY_VERSION_ID,
        outcome: "denied",
      }),
    );
  });

  it("reads nothing about a patient to render a governance record", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    const store = await seededStore();
    const { store: spied } = withAccessSpy(store);
    const version = vi.spyOn(spied, "getPathwayVersion");
    const episode = vi.spyOn(spied, "getEpisode");
    const names = vi.spyOn(spied, "listPatientNames");

    await renderPage(DEMO_SEED_PATHWAY_VERSION_ID);

    // The positive control the absences below need: the page really did read the spied store, so
    // "nothing about a patient was read" is a fact about this render rather than about a store
    // nobody touched.
    expect(version, "the page did not read the spied store — the absences below prove nothing").toHaveBeenCalled();
    expect(episode).not.toHaveBeenCalled();
    expect(names).not.toHaveBeenCalled();
  });
});

describe("the template detail page fails closed rather than rendering a record it did not read", () => {
  it("throws when the access trail cannot take the event", async () => {
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    const DetailPage = await importPage();

    await expect(DetailPage({ params: Promise.resolve({ pathwayId: HELD_ID }) })).rejects.toThrow(
      /access trail is unavailable/i,
    );
  });

  it("throws when the version read itself fails, and still records the attempt", async () => {
    const { store, recorded } = emptyStoreWithSpy();
    vi.spyOn(store, "getPathwayVersion").mockRejectedValue(new Error("store unreachable"));

    const DetailPage = await importPage();

    await expect(DetailPage({ params: Promise.resolve({ pathwayId: HELD_ID }) })).rejects.toThrow("store unreachable");
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "pathwayVersion", outcome: "failed" }));
  });

  it("throws when the service state read fails, rather than rendering a record beside no safety state", async () => {
    const { store } = emptyStoreWithSpy();
    vi.spyOn(store, "getServiceState").mockRejectedValue(new Error("service state unreachable"));

    const DetailPage = await importPage();

    await expect(DetailPage({ params: Promise.resolve({ pathwayId: HELD_ID }) })).rejects.toThrow(
      "service state unreachable",
    );
  });
});

describe("the template detail page renders the demo population's governed version", () => {
  it("qualifies its approvals and shows the wording its record holds, inside the region that names it", async () => {
    mockCookies = { [CARING_CONTACTS_ROLE_COOKIE]: { value: "coordinator" } };
    // The REAL seed, through the repository's own methods: two approvals, two roles, two people,
    // neither of them the author, and `publish` after that. Nothing about the shape of the record
    // this produces distinguishes it from one people really approved -- which is why the snapshot
    // carries `provenance` and why the qualification below is the point of the screen.
    withAccessSpy(await seededStore());

    await renderPage(DEMO_SEED_PATHWAY_VERSION_ID);

    const approvalCard = screen.getByTestId("caring-contacts-template-detail-approval");
    expect(approvalCard.textContent).toContain(`Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead}`);
    expect(approvalCard.textContent).toContain(
      `Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.livedExperienceRepresentative}`,
    );
    expect(screen.getByTestId("caring-contacts-template-detail-provenance")).toHaveTextContent(
      PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
    );

    // RULING [127], IN THE ONE PLACE THE SPECIMEN IS ACTUALLY WITHIN REACH, and the requirement
    // here is the OPPOSITE of the library's. The seed writes `PATIENT_VISIBLE_MESSAGE_TEMPLATE` into
    // `snapshot.messageTextByType.standard`, so this render is the only one where the real string
    // is in the page's own data. The library must never show it; this screen must, because a
    // governance record viewer that withheld the record's contents would be describing a record
    // nobody can check. What is pinned is WHERE it appears: inside the quotation that names it as
    // the wording this record holds, and nowhere else on the page.
    const standard = screen.getByTestId("caring-contacts-template-detail-wording-standard");
    expect(standard).toHaveTextContent(PATIENT_VISIBLE_MESSAGE_TEMPLATE);
    expect(occurrences(document.body.textContent ?? "", PATIENT_VISIBLE_MESSAGE_TEMPLATE)).toBe(1);
    expect(document.body.textContent ?? "").toContain("Nothing below is addressed to anybody");

    // RULING [131], ASSERTED WHERE IT IS LOAD-BEARING RATHER THAN MERELY REACHABLE. This is the
    // only render in the suite where all three sit together: two recorded approvals above, the
    // REAL patient-visible specimen below, and the provenance qualification between them. That
    // adjacency is what made round 1's deleted sentence dangerous, so the status is pinned here
    // and not only against fixture markers.
    expect(screen.getByTestId("caring-contacts-template-detail-wording-status")).toHaveTextContent(
      CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
    );

    // The seed leaves `first` and `closing` empty, which is the truthful representation of "not
    // yet written". Nothing is rendered for either, and the screen says so.
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-first")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-closing")).toBeNull();
    expect(document.body.textContent ?? "").toContain(
      "Nothing has been written for the first message and the closing message.",
    );
  });
});

async function seededStore(): Promise<CaringContactRepository> {
  return createDemoWorkspaceStore(fixedClock(NOW));
}

function occurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}
