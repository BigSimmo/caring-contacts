// tests/caring-contacts-new-plan-page.dom.test.tsx
//
// `/caring-contacts/plans/new` (`src/app/caring-contacts/plans/new/page.tsx`) — the server half of
// the activation wizard.
//
// TWO CONTRACTS THIS FILE EXISTS FOR:
//
//   1. THE SERVICE STATE NEVER CROSSES THE CLIENT BOUNDARY (Ruling [109]). `ServiceState` carries a
//      free-text incident `note`, gated on the server behind `viewPatientRecord`. The wizard is the
//      first deliberate Client Component in this workspace and is exactly where that note would be
//      easiest to leak, so the props this page builds are ASSERTED rather than read. The page's
//      returned element tree is inspected without rendering the wizard: what is under test is what
//      the server hands across, not what the client draws.
//   2. AN UNSEEABLE REFERRAL IS NEVER A 404 (Ruling [111]). `notFound()` would distinguish "no such
//      referral" from "another team's", which is precisely the distinction the store refuses to
//      make. Every one of those states is a rendered screen that says what it is, and the only
//      `notFound()` on this page is the production demo lock, which is a different fact entirely.
//
// Built on the same helper shape as `caring-contacts-patients-page.dom.test.tsx`.
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

import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { idempotencyKey, pathwayVersionId, patientId, referralId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { EXACT_PATIENT_VISIBLE_MESSAGE } from "@/lib/caring-contacts/message-copy";
import {
  PATHWAY_VERSION_PROVENANCE_WORDING,
  type PathwayVersion,
  type PathwayVersionProvenance,
} from "@/lib/caring-contacts/pathway-versions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";

let mockCookies: Record<string, { value: string } | undefined> = {};

const NOW = "2026-03-02T03:00:00.000Z";
const REFERRAL = "SYN-REFERRAL-001";
const PATIENT = "SYN-PATIENT-001";
const PATHWAY = "SYN-PATHWAY-001";
const CADENCE_LABELS = ["Day 1", "Week 1"];

/** The exact words of a live incident, so a leak is recognisable rather than inferred. */
const INCIDENT_NOTE = "Wrong number reached a third party on the afternoon send.";

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

/**
 * A pathway version this team may start a plan on.
 *
 * Walked through the real governance rather than written straight into storage as `approved`:
 * `savePathwayVersion` forces `state: "draft"`, an empty approval list and the acting actor as
 * author, whatever the caller sends (Ruling 14), and `applyPathwayVersionTransition` grants
 * `approved` only on the approval that completes both required roles, by two different people,
 * neither of them the author. A fixture that bypassed that would prove the page against a version
 * shape the domain cannot produce.
 */
/**
 * `provenance` is typed loosely on purpose. A store reads the snapshot back with an unchecked cast,
 * so a value outside the union genuinely can reach a screen with the type insisting it cannot -- and
 * that is the case round 2 found renders an empty qualifier beside an unqualified approval. A
 * fixture able to produce only union members could not reach it at all.
 */
async function seedApprovedVersion(
  store: CaringContactRepository,
  id: string,
  provenance?: PathwayVersionProvenance | (string & {}),
) {
  const author = demoActorForRole("coordinator");
  const programmeLead = demoActorForRole("clinicalProgrammeLead");
  const representative = demoActorForRole("livedExperienceRepresentative");
  const version = pathwayVersionId(id);

  const saved = await store.savePathwayVersion(
    {
      version: {
        id: version,
        teamId: author.teamId,
        state: "draft",
        authorId: author.id,
        approvals: [],
        publishedAt: null,
        retiredAt: null,
        retirementUrgency: null,
        snapshot: {
          cadenceLabels: CADENCE_LABELS,
          messageTextByType: { standard: "standard", first: "first", closing: "closing" },
          // Cast exactly where the Postgres reader casts (`row.snapshot as PathwayVersionSnapshot`).
          // That unchecked cast is the whole mechanism by which a provenance outside the union
          // reaches a screen typed as one inside it, so a fixture that could not express it could
          // not reproduce the defect.
          ...(provenance === undefined ? {} : { provenance: provenance as PathwayVersionProvenance }),
        },
      } satisfies PathwayVersion,
    },
    { actor: author, idempotencyKey: idempotencyKey(`seed-save-${id}`) },
  );
  expect(saved.ok, "seeding the pathway version failed").toBe(true);

  for (const [step, actor, action] of [
    ["submit", author, { type: "submitForReview" as const }],
    [
      "lead",
      programmeLead,
      { type: "approve" as const, role: "clinicalProgrammeLead" as const, actorId: programmeLead.id },
    ],
    [
      "representative",
      representative,
      { type: "approve" as const, role: "livedExperienceRepresentative" as const, actorId: representative.id },
    ],
  ] as const) {
    const result = await store.transitionPathwayVersion(
      { pathwayVersionId: version, action },
      { actor, idempotencyKey: idempotencyKey(`seed-${step}-${id}`) },
    );
    expect(result.ok, `seeding the pathway version failed at ${step}`).toBe(true);
  }
}

/** A referral this team has accepted, on an approved pathway version. */
async function seedAcceptedReferral(
  store: CaringContactRepository,
  provenance?: PathwayVersionProvenance | (string & {}),
) {
  const actor = demoActorForRole("coordinator");
  const write = (key: string) => ({ actor, idempotencyKey: idempotencyKey(key) });

  await seedApprovedVersion(store, PATHWAY, provenance);

  const created = await store.createReferral(
    { referralId: referralId(REFERRAL), patientId: patientId(PATIENT) },
    write("seed-referral"),
  );
  expect(created.ok, "seeding the referral failed").toBe(true);

  const accepted = await store.transitionReferral(
    { referralId: referralId(REFERRAL), action: { type: "accept", pathwayVersionId: pathwayVersionId(PATHWAY) } },
    write("seed-accept"),
  );
  expect(accepted.ok, "accepting the referral failed").toBe(true);
}

async function loadPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const { default: NewPlanPage } = await import("@/app/caring-contacts/plans/new/page");
  return (await NewPlanPage({ searchParams: Promise.resolve(searchParams) })) as ReactElement<{
    children: ReactElement<Record<string, unknown>>;
    serviceState: unknown;
  }>;
}

/**
 * The body the shell wraps, rendered on its own.
 *
 * Rendering the shell would drag `next/dynamic` and the whole workspace chrome into a test about
 * one screen — the same reason the patients-page test unwraps it.
 */
async function renderBody(searchParams: Record<string, string | string[] | undefined> = {}) {
  const element = await loadPage(searchParams);
  render(element.props.children);
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

describe("the /caring-contacts/plans/new page — the service state stays on the server (Ruling [109])", () => {
  it("hands the wizard no service state and nothing derived from one, during a live incident", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store);
    const stopped = await store.stopService(
      { reason: "wrong-recipient", note: INCIDENT_NOTE },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("stop-1") },
    );
    expect(stopped.ok, "seeding the service stop failed").toBe(true);

    const element = await loadPage({ referral: REFERRAL });
    const wizard = element.props.children;

    // The shell still gets the state it must have — the safety banner is required on every screen.
    expect(element.props.serviceState).toBeTruthy();
    expect(JSON.stringify(element.props.serviceState)).toContain(INCIDENT_NOTE);

    // The wizard gets none of it, by any name.
    expect(Object.keys(wizard.props)).not.toContain("serviceState");
    expect(JSON.stringify(wizard.props), "an incident note reached the wizard's props").not.toContain(INCIDENT_NOTE);
    expect(JSON.stringify(wizard.props)).not.toMatch(/wrong-recipient/);

    // What it does get is the referral it starts from and the versions it may offer.
    expect(wizard.props).toMatchObject({
      referralId: REFERRAL,
      patientId: PATIENT,
      teamId: demoActorForRole("coordinator").teamId,
      referralPathwayVersionId: PATHWAY,
    });
    expect(wizard.props.pathwayOptions).toEqual([
      expect.objectContaining({
        id: PATHWAY,
        cadenceLabels: CADENCE_LABELS,
        // Round 1, M-2: the page resolves the governance seats to plain words, so no domain
        // identifier crosses into the client bundle or onto a clinical screen.
        approvedBy: ["the clinical programme lead", "the lived-experience representative"],
        // Ruling [126]: this fixture's version claims no provenance, so the page passes none. The
        // page's job is to carry what the record says, never to decide it.
        provenanceNote: null,
      }),
    ]);
    expect(wizard.props.actorRoleLabels).toEqual(["coordinator"]);
    // Task 11a: the patient-visible wording stage 3 previews comes from the SEALED DOMAIN, resolved
    // here. This is the assertion that can actually fail -- a page that wrote the sentence out, or
    // paraphrased it, would satisfy the wizard's own "renders what it is handed" case perfectly.
    // The wording is changing (the owner has decided it gains a first-name slot), so this compares
    // against the module's export rather than against a copy of today's sentence.
    expect(wizard.props.patientVisibleMessageSpecimen).toBe(EXACT_PATIENT_VISIBLE_MESSAGE);
  });

  // Ruling [126], round 1 finding I2. `approvedBy` above is a claim about provenance, and a
  // demonstration version's approvals were given by nobody. This is the join: the page must carry
  // what the RECORD says into the prop the wizard prints, and must resolve it to words here so the
  // domain module stays out of the client chunk -- the same treatment `approvedBy` gets.
  it("carries a version's own provenance into the wizard, resolved to plain words", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store, "syntheticDemonstration");

    const element = await loadPage({ referral: REFERRAL });
    // `loadPage` types the rendered element's props as `unknown`, which is why the cases above
    // assert through `expect` rather than reaching in. Narrowed here rather than cast to the
    // component's own option type: a structural read of the one field under test cannot quietly
    // start passing because that type gained or lost something else.
    const options = element.props.children.props.pathwayOptions as readonly { provenanceNote: unknown }[];

    expect(options).toHaveLength(1);
    expect(options[0].provenanceNote).toBe(PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration);
    // Resolved, not forwarded: the raw domain value must not cross onto the screen.
    expect(options[0].provenanceNote).not.toBe("syntheticDemonstration");
  });

  // Round 2. The failure this covers is invisible to every other case here, because no fixture and
  // no writer produces the value: `savePathwayVersion` copies the snapshot verbatim and the Postgres
  // reader casts it back unchecked, so a provenance this build does not recognise arrives typed as
  // one it does. The qualifier must survive that, because the alternative is the screen dropping it
  // silently for exactly the record it understands least.
  it("keeps the qualifier when the record's provenance is not one this build recognises", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store, "someLaterProvenanceKind");

    const element = await loadPage({ referral: REFERRAL });
    const options = element.props.children.props.pathwayOptions as readonly { provenanceNote: unknown }[];

    expect(options).toHaveLength(1);
    expect(options[0].provenanceNote).toBe(PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration);
    // Not `undefined`, which is what the earlier lookup produced and what a `=== null` test cannot see.
    expect(options[0].provenanceNote).not.toBeUndefined();
  });
});

describe("the /caring-contacts/plans/new page — an unseeable referral is not a missing resource", () => {
  it("says what it needs when the URL names no referral, and never calls notFound()", async () => {
    inMemoryStoreWithSpy();

    await renderBody();

    expect(mocks.notFound).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "No referral named" })).toHaveTextContent(/accepted/i);
  });

  it("offers each accepted referral without a plan when no referral is named, so New plan is never a dead end", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store);

    await renderBody();

    const list = screen.getByTestId("caring-contacts-startable-referrals");
    expect(list).toHaveTextContent(REFERRAL);
    expect(list).toHaveTextContent(PATIENT);
    const start = screen.getByRole("link", { name: `Start a plan for referral ${REFERRAL}` });
    expect(start.getAttribute("href")).toBe(`/caring-contacts/plans/new?referral=${REFERRAL}`);
    expect(screen.queryByRole("group", { name: "No referral named" })).toBeNull();
  });

  // 2026-09-26. The list used to show two raw identifiers per row, offered patients whose running
  // plan would get the wizard refused with a 409 at its last step, and repeated a patient once per
  // accepted referral.
  async function seedIntakeReferral(
    store: CaringContactRepository,
    id: string,
    patient: string,
    intake: { givenName: string; familyName: string; dischargeDate: string; hospitalFacility: string } | null,
    accept = true,
  ) {
    const actor = demoActorForRole("coordinator");
    const created = await store.createReferral(
      {
        referralId: referralId(id),
        patientId: patientId(patient),
        intakePayload: intake && {
          patientIdentifier: patient,
          mobileNumber: "0491570006",
          cohort: "adult",
          admittingWard: "Ward 1",
          clinicalSummary: "Synthetic.",
          safetyAlerts: [],
          ...intake,
        },
      },
      { actor, idempotencyKey: idempotencyKey(`seed-${id}`) },
    );
    expect(created.ok, `seeding ${id} failed`).toBe(true);
    if (accept) await acceptReferral(store, id);
  }

  async function acceptReferral(store: CaringContactRepository, id: string) {
    const actor = demoActorForRole("coordinator");
    const accepted = await store.transitionReferral(
      { referralId: referralId(id), action: { type: "accept", pathwayVersionId: pathwayVersionId(PATHWAY) } },
      { actor, idempotencyKey: idempotencyKey(`seed-accept-${id}`) },
    );
    expect(accepted.ok, `accepting ${id} failed`).toBe(true);
  }

  it("names each startable referral's patient, discharge date and hospital in readable words", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedApprovedVersion(store, PATHWAY);
    await seedIntakeReferral(store, "SYN-REFERRAL-A", "SYN-PATIENT-A", {
      givenName: "Robin",
      familyName: "Example",
      dischargeDate: "2026-02-27T02:00:00.000Z",
      hospitalFacility: "Fiona Stanley Hospital",
    });

    await renderBody();

    const list = screen.getByTestId("caring-contacts-startable-referrals");
    expect(list).toHaveTextContent("Robin Example");
    expect(list).toHaveTextContent("Discharged27 February 2026");
    expect(list).toHaveTextContent("Fiona Stanley Hospital");
    expect(list).not.toHaveTextContent("2026-02-27T");
    expect(screen.getByRole("link", { name: "Start a plan for Robin Example, referral SYN-REFERRAL-A" })).toBeVisible();
  });

  it("offers only the newest accepted referral when several name the same patient", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedApprovedVersion(store, PATHWAY);
    const intake = { givenName: "Robin", familyName: "Example", hospitalFacility: "Royal Perth Hospital" };
    // Both created before either is accepted: the store refuses a second referral for a patient who
    // already has an accepted one, but not two waiting side by side that are then both accepted.
    await seedIntakeReferral(
      store,
      "SYN-REFERRAL-NEWER",
      "SYN-PATIENT-A",
      { ...intake, dischargeDate: "2026-03-01T02:00:00.000Z" },
      false,
    );
    await seedIntakeReferral(
      store,
      "SYN-REFERRAL-OLDER",
      "SYN-PATIENT-A",
      { ...intake, dischargeDate: "2026-02-01T02:00:00.000Z" },
      false,
    );
    await acceptReferral(store, "SYN-REFERRAL-NEWER");
    await acceptReferral(store, "SYN-REFERRAL-OLDER");

    await renderBody();

    const list = screen.getByTestId("caring-contacts-startable-referrals");
    expect(list).toHaveTextContent("SYN-REFERRAL-NEWER");
    expect(list).not.toHaveTextContent("SYN-REFERRAL-OLDER");
  });

  it("leaves out a patient whose plan has not ended, and keeps one whose plan has", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedApprovedVersion(store, PATHWAY);
    await seedIntakeReferral(store, "SYN-REFERRAL-LIVE", "SYN-PATIENT-LIVE", null);
    await seedIntakeReferral(store, "SYN-REFERRAL-ENDED", "SYN-PATIENT-ENDED", null);
    // Plans on OTHER referrals for these two patients: one running, one completed.
    const plans = [
      { plan: { state: "active" }, patientId: "SYN-PATIENT-LIVE", referralId: "SYN-REFERRAL-EARLIER-1" },
      { plan: { state: "completed" }, patientId: "SYN-PATIENT-ENDED", referralId: "SYN-REFERRAL-EARLIER-2" },
    ];
    (mocks.store.current as { listPlans: unknown }).listPlans = async () => plans;

    await renderBody();

    const list = screen.getByTestId("caring-contacts-startable-referrals");
    expect(list).not.toHaveTextContent("SYN-REFERRAL-LIVE");
    expect(list).toHaveTextContent("SYN-REFERRAL-ENDED");
    expect(list).toHaveTextContent("Name not held on this referral");
  });

  it("leaves a referral that is not yet accepted out of that list", async () => {
    const { store } = inMemoryStoreWithSpy();
    const created = await store.createReferral(
      { referralId: referralId(REFERRAL), patientId: patientId(PATIENT) },
      { actor: demoActorForRole("coordinator"), idempotencyKey: idempotencyKey("seed-referral") },
    );
    expect(created.ok).toBe(true);

    await renderBody();

    expect(screen.queryByTestId("caring-contacts-startable-referrals")).toBeNull();
    expect(screen.getByRole("group", { name: "No referral named" })).toBeInTheDocument();
  });

  it("gives one answer for a referral that does not exist and one belonging to another team", async () => {
    inMemoryStoreWithSpy();

    await renderBody({ referral: "SYN-REFERRAL-NOT-OURS" });

    expect(mocks.notFound).not.toHaveBeenCalled();
    const statement = screen.getByRole("group", { name: "That referral is not one you can open" });
    expect(statement, "the answer distinguishes the two cases it must not").toHaveTextContent(
      /same answer here, on purpose/i,
    );
  });

  it("states a referral that has not been accepted, rather than starting a plan on it", async () => {
    const { store } = inMemoryStoreWithSpy();
    const actor = demoActorForRole("coordinator");
    const created = await store.createReferral(
      { referralId: referralId(REFERRAL), patientId: patientId(PATIENT) },
      { actor, idempotencyKey: idempotencyKey("seed-referral") },
    );
    expect(created.ok).toBe(true);

    await renderBody({ referral: REFERRAL });

    expect(screen.getByRole("group", { name: "This referral has not been accepted" })).toHaveTextContent(
      /waiting to be handed over/i,
    );
  });

  it("decides the capability from the ACTOR, not from an empty list", async () => {
    // `listReferrals` answers an actor without `viewReferral` with `[]`, exactly as it answers a
    // team with no referrals. A screen that only counted rows would tell an auditor no such
    // referral exists — a claim about records they are simply not allowed to see (Ruling 92).
    const { store } = inMemoryStoreWithSpy("auditor");
    await seedAcceptedReferral(store);

    await renderBody({ referral: REFERRAL });

    expect(screen.getByRole("group", { name: "Starting a plan is not part of this role" })).toHaveTextContent(
      /role you are acting in/i,
    );
  });

  it("treats a repeated ?referral= as naming none rather than failing the render", async () => {
    inMemoryStoreWithSpy();

    await renderBody({ referral: [REFERRAL, "SYN-REFERRAL-002"] });

    expect(screen.getByRole("group", { name: "No referral named" })).toBeInTheDocument();
  });
});

describe("the /caring-contacts/plans/new page — every read is audited and fails closed", () => {
  it("records the service-state, referral and pathway-version reads with the API side's identities", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store);

    await loadPage({ referral: REFERRAL });

    const actor = demoActorForRole("coordinator");
    for (const access of [
      { kind: "administrative", objectType: "serviceState", objectId: "service" },
      { kind: "search", objectType: "patientDirectory", objectId: "all" },
      { kind: "view", objectType: "pathwayVersion", objectId: "all" },
    ]) {
      expect(recorded(), `${access.objectType} read was not recorded as the API route records it`).toContainEqual(
        expect.objectContaining({ ...access, outcome: "allowed", actorId: actor.id }),
      );
    }
  });

  it("does not read the pathway versions for a referral it will not start from", async () => {
    // A read made for a screen that then says "that referral is not one you can open" bought
    // nothing and still went on the trail.
    const { recorded } = inMemoryStoreWithSpy();

    await loadPage({ referral: "SYN-REFERRAL-NOT-OURS" });

    expect(recorded().map((record) => record.objectType)).not.toContain("pathwayVersion");
  });

  it("throws rather than rendering when the access trail cannot take the event", async () => {
    const { store } = inMemoryStoreWithSpy();
    vi.spyOn(store, "recordAccess").mockRejectedValue(new Error("access trail unavailable"));

    await expect(loadPage({ referral: REFERRAL })).rejects.toThrow(/access trail is unavailable/i);
  });

  it("throws rather than rendering when the referral read itself fails", async () => {
    const { store, recorded } = inMemoryStoreWithSpy();
    vi.spyOn(store, "listReferrals").mockRejectedValue(new Error("store unreachable"));

    await expect(loadPage({ referral: REFERRAL })).rejects.toThrow("store unreachable");
    // The failed attempt is still recorded — an event nobody wrote is worse than a refused read.
    expect(recorded()).toContainEqual(expect.objectContaining({ objectType: "patientDirectory", outcome: "failed" }));
  });

  it("throws rather than rendering when the pathway-version read fails", async () => {
    const { store } = inMemoryStoreWithSpy();
    await seedAcceptedReferral(store);
    vi.spyOn(store, "listPathwayVersions").mockRejectedValue(new Error("versions unreachable"));

    await expect(loadPage({ referral: REFERRAL })).rejects.toThrow("versions unreachable");
  });

  it("calls notFound() only for the production demo lock", async () => {
    inMemoryStoreWithSpy();
    vi.stubEnv("NODE_ENV", "production");

    await expect(loadPage({ referral: REFERRAL })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });
});
