// tests/caring-contacts-demo-seed.test.ts
//
// Task SEED. The running prototype was empty and could not be driven end to end: no route can
// create a pathway version (`pathway-versions/route.ts` refuses deliberately, and correctly), and
// the one route that creates a referral is called by no screen. So the activation wizard needed a
// referral it could not get and a pathway it could not get, and every list screen was honestly
// empty.
//
// The seed closes that. These tests hold it to the three properties that make it safe rather than
// merely convenient:
//
//   1. IT CANNOT REACH A DATABASE. Not "must not" -- cannot. The seed module builds its own
//      in-memory store and refuses any store it did not build, so a Postgres repository has no
//      parameter to arrive through and no path to be seeded by. The Postgres branch of
//      `caringContactsStore()` never calls it at all, which is the first assertion below.
//   2. IT IS NOT A PRIVILEGED BACK DOOR. Every record is written through the repository's own
//      methods, with a real demo actor and a real idempotency key. The governance a pathway
//      version carries is therefore a governance record the domain produced, not one written into
//      a Map -- two different approvers, checked by `applyPathwayVersionTransition` itself.
//   3. IT AUTHORS NO PATIENT-VISIBLE WORDING. `standard` is the sealed domain's one owner-reviewed
//      message; `first` and `closing` are EMPTY, because no wording has been authored for them.
//      An empty string is the truthful representation of "not yet written". A closing message that
//      did not say it was the last in the programme would be a documented harm, and the wording is
//      the lived-experience representative's to write, not an implementer's.
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCaringContactsPool: vi.fn((url: string) => ({ url, withConnection: vi.fn() })),
  createPostgresRepository: vi.fn(() => ({ instance: Symbol("postgres-repository-instance") })),
  createDemoWorkspaceStore: vi.fn(),
}));

vi.mock("@/lib/caring-contacts-server/pool", () => ({
  createCaringContactsPool: mocks.createCaringContactsPool,
}));

vi.mock("@/lib/caring-contacts/db/postgres-repository", () => ({
  createPostgresRepository: mocks.createPostgresRepository,
}));

// The REAL seed module, behind a spy. Wrapping rather than replacing matters: every other test in
// this file exercises the genuine implementation, and the spy shares its module instance -- so the
// WeakSet of stores the seed built is the same one `applyDemoSeed` checks against.
vi.mock("@/lib/caring-contacts-server/demo-seed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/caring-contacts-server/demo-seed")>();
  mocks.createDemoWorkspaceStore.mockImplementation(actual.createDemoWorkspaceStore);
  return { ...actual, createDemoWorkspaceStore: mocks.createDemoWorkspaceStore };
});

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

import {
  applyDemoSeed,
  CARING_CONTACTS_DEMO_SEED_VAR,
  createDemoWorkspaceStore,
  DEMO_SEED_PATHWAY_VERSION_ID,
  DEMO_SEED_UNSTARTED_REFERRAL_ID,
  DemoSeedForeignStoreError,
} from "@/lib/caring-contacts-server/demo-seed";
import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import { CARING_CONTACTS_STORE_GLOBAL_KEY, caringContactsStore } from "@/lib/caring-contacts-server/store";
import { awstCalendarDay, systemClock } from "@/lib/caring-contacts/clock";
import { pathwayVersionId as toPathwayVersionId, planId as toPlanId } from "@/lib/caring-contacts/ids";
import {
  PATIENT_VISIBLE_MESSAGE_TEMPLATE,
  PREFERRED_NAME_PLACEHOLDER,
  SPECIMEN_PREFERRED_NAME,
} from "@/lib/caring-contacts/message-copy";
import { DISPATCHED_CONTACT_STATES } from "@/lib/caring-contacts/model";
import { PATHWAY_VERSION_PROVENANCE_WORDING } from "@/lib/caring-contacts/pathway-versions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "@/lib/caring-contacts/synthetic-contacts";

function clearCachedStore(): void {
  Reflect.deleteProperty(globalThis, CARING_CONTACTS_STORE_GLOBAL_KEY);
}

afterEach(() => {
  vi.unstubAllEnvs();
  clearCachedStore();
  mocks.createCaringContactsPool.mockClear();
  mocks.createPostgresRepository.mockClear();
  mocks.createDemoWorkspaceStore.mockClear();
});

const coordinator = demoActorForRole("coordinator");

async function seededStore(): Promise<CaringContactRepository> {
  return createDemoWorkspaceStore(systemClock());
}

describe("the demo seed cannot run against a database", () => {
  it("is never reached from the Postgres branch of caringContactsStore", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://demo@example.invalid:5432/postgres");

    const store = await caringContactsStore();

    expect(mocks.createPostgresRepository).toHaveBeenCalledTimes(1);
    expect(store).toBe(mocks.createPostgresRepository.mock.results[0]?.value);
    expect(mocks.createDemoWorkspaceStore).not.toHaveBeenCalled();
  });

  it("is reached from the in-memory branch, once, and the memoised second call re-uses that store", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");

    const first = await caringContactsStore();
    const second = await caringContactsStore();

    expect(second).toBe(first);
    expect(mocks.createDemoWorkspaceStore).toHaveBeenCalledTimes(1);
    expect(mocks.createPostgresRepository).not.toHaveBeenCalled();
    expect(await first.listPlans({ actor: coordinator })).not.toHaveLength(0);
  });

  it("leaves the store empty in production, where no demo actor can be resolved anyway", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");

    const store = await caringContactsStore();

    expect(await store.listPlans({ actor: coordinator })).toHaveLength(0);
    expect(await store.listReferrals({ actor: coordinator })).toHaveLength(0);
    expect(await store.listPathwayVersions({ actor: coordinator })).toHaveLength(0);
  });

  // The isolated Playwright server is the one place the demo predicate is true inside a production
  // build. `tests/ui-caring-contacts-workspace.spec.ts` observes the empty-caseload contract there
  // -- an empty list served as a page, saying in words which of the three facts it is -- so the
  // population must not appear by default and delete that observation.
  it("leaves the isolated Playwright server empty unless a journey asks for the population", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "true");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");

    const unasked = await caringContactsStore();
    expect(await unasked.listPlans({ actor: coordinator })).toHaveLength(0);

    clearCachedStore();
    vi.stubEnv(CARING_CONTACTS_DEMO_SEED_VAR, "on");

    const asked = await caringContactsStore();
    expect(await asked.listPlans({ actor: coordinator })).not.toHaveLength(0);
  });

  // Round 1, I1. The store handed back in production IS one this module built -- built and left
  // empty -- so the WeakSet alone would have admitted it. This is the case that says the production
  // boundary is checked where the writes are, not only where the store is constructed.
  it("refuses to populate a production store even though it built that store itself", async () => {
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");

    const store = await caringContactsStore();
    const outcome = await applyDemoSeed(store, systemClock());

    expect(outcome.populated).toBe(false);
    expect(await store.listPathwayVersions({ actor: coordinator })).toHaveLength(0);
    expect(await store.listPlans({ actor: coordinator })).toHaveLength(0);
    expect(await store.listAuditEvents({ actor: demoActorForRole("auditor") })).toHaveLength(0);
  });

  it("refuses a store it did not build, so a Postgres repository has no way in", async () => {
    const foreign = mocks.createPostgresRepository() as unknown as CaringContactRepository;

    await expect(applyDemoSeed(foreign, systemClock())).rejects.toBeInstanceOf(DemoSeedForeignStoreError);
  });
});

describe("the demo seed is idempotent", () => {
  it("populates once and leaves an already-populated store untouched", async () => {
    const store = await seededStore();

    const plansAfterFirst = await store.listPlans({ actor: coordinator });
    const referralsAfterFirst = await store.listReferrals({ actor: coordinator });
    const auditAfterFirst = await store.listAuditEvents({ actor: demoActorForRole("auditor") });

    const second = await applyDemoSeed(store, systemClock());

    expect(second.populated).toBe(false);
    expect(await store.listPlans({ actor: coordinator })).toHaveLength(plansAfterFirst.length);
    expect(await store.listReferrals({ actor: coordinator })).toEqual(referralsAfterFirst);
    expect(await store.listAuditEvents({ actor: demoActorForRole("auditor") })).toHaveLength(auditAfterFirst.length);
  });
});

describe("the seeded pathway version", () => {
  it("is approved by two different people through the domain's own transition, published, and not retired", async () => {
    const store = await seededStore();

    const versions = await store.listPathwayVersions({ actor: coordinator });
    expect(versions).toHaveLength(1);
    const version = versions[0];

    expect(version.id).toBe(DEMO_SEED_PATHWAY_VERSION_ID);
    expect(version.state).toBe("approved");
    expect(version.retiredAt).toBeNull();
    expect(version.publishedAt).not.toBeNull();
    expect(version.approvals.map((approval) => approval.role).sort()).toEqual([
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
    ]);
    expect(new Set(version.approvals.map((approval) => approval.actorId)).size).toBe(2);
    expect(version.approvals.every((approval) => approval.actorId !== version.authorId)).toBe(true);
  });

  it("carries the one owner-reviewed message and leaves the unauthored ones empty", async () => {
    const store = await seededStore();
    const [version] = await store.listPathwayVersions({ actor: coordinator });

    expect(version.snapshot.messageTextByType.standard).toBe(PATIENT_VISIBLE_MESSAGE_TEMPLATE);
    // The "Hi Rowan" defect (2026-09-26): the stored wording carries the preferred-name slot, never
    // the specimen's fictional name, so each patient is greeted by their own name at send time.
    expect(version.snapshot.messageTextByType.standard.startsWith(`Hi ${PREFERRED_NAME_PLACEHOLDER},`)).toBe(true);
    expect(version.snapshot.messageTextByType.standard).not.toContain(SPECIMEN_PREFERRED_NAME);
    expect(version.snapshot.messageTextByType.first).toBe("");
    expect(version.snapshot.messageTextByType.closing).toBe("");
  });

  // Round 1, I2. The approvals below are structurally genuine and were given by nobody, and stage 2
  // of the wizard prints them in plain words. The record has to say which it is, and it has to
  // still say so after the store has copied it -- `clonePathwayVersion` enumerated the snapshot's
  // fields and would have dropped this one.
  it("marks its own governance as invented, and the marker survives the store's copy", async () => {
    const store = await seededStore();

    const [listed] = await store.listPathwayVersions({ actor: coordinator });
    const fetched = await store.getPathwayVersion(toPathwayVersionId(DEMO_SEED_PATHWAY_VERSION_ID), {
      actor: coordinator,
    });

    expect(listed.snapshot.provenance).toBe("syntheticDemonstration");
    expect(fetched?.snapshot.provenance).toBe("syntheticDemonstration");
    // The marker weakens a claim and never strengthens one, so the wording must not read as an
    // endorsement of the version it sits on.
    expect(PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration).toMatch(/no person recorded/i);
  });

  it("names the cadence the approved schedule really builds rather than a second copy of it", async () => {
    const store = await seededStore();
    const [version] = await store.listPathwayVersions({ actor: coordinator });
    const [plan] = await store.listPlans({ actor: coordinator });
    const contacts = await store.listContacts(toPlanId(plan.plan.id), { actor: coordinator });

    expect(version.snapshot.cadenceLabels).toEqual(contacts.map((entry) => entry.planned.cadenceLabel));
  });
});

describe("the seeded population", () => {
  it("gives the wizard an accepted referral with no plan, and shows one still awaiting handover", async () => {
    const store = await seededStore();

    const referrals = await store.listReferrals({ actor: coordinator });
    const plans = await store.listPlans({ actor: coordinator });
    const patientsWithPlans = new Set(plans.map((record) => String(record.patientId)));

    const unstarted = referrals.find((referral) => referral.id === DEMO_SEED_UNSTARTED_REFERRAL_ID);
    expect(unstarted?.state).toBe("accepted");
    expect(unstarted?.pathwayVersionId).toBe(DEMO_SEED_PATHWAY_VERSION_ID);
    expect(patientsWithPlans.has(String(unstarted?.patientId))).toBe(false);

    expect(referrals.filter((referral) => referral.state === "awaitingHandover")).toHaveLength(1);
  });

  it("shows a plan that is running, one that is paused, and one that has been stopped", async () => {
    const store = await seededStore();

    const states = (await store.listPlans({ actor: coordinator })).map((record) => record.plan.state).sort();

    expect(states).toEqual(["active", "paused", "withdrawn"]);
  });

  it("names every patient in the caseload", async () => {
    const store = await seededStore();

    const names = await store.listPatientNames({ actor: coordinator });
    const plans = await store.listPlans({ actor: coordinator });

    // Round 1, I4. "One name per plan" is the projection's promise, but on an empty store it is
    // also 0 === 0 -- so a seed that produced nothing would satisfy it. The guard is what makes the
    // comparison mean something; without it this case cannot fail on its own.
    expect(plans).not.toHaveLength(0);
    expect(names).toHaveLength(plans.length);
    expect(names.every((entry) => entry.patientName.trim() !== "")).toBe(true);
  });

  it("uses only the reserved fictional numbers that can never connect to anyone", async () => {
    const store = await seededStore();
    const plans = await store.listPlans({ actor: coordinator });

    const numbers = await Promise.all(
      plans.map(
        async (record) =>
          (await store.getEpisode(toPlanId(record.plan.id), { actor: coordinator }))?.patientMobileNumber,
      ),
    );

    // Round 1, I4, and this is the one that mattered: without the guard, a seed that created no
    // plans leaves `numbers` empty, the length comparison passes as 0 === 0, and the loop below
    // iterates nothing -- so the case that exists to prove no unreserved number was ever written
    // would go green having checked no number at all.
    expect(plans).not.toHaveLength(0);
    expect(numbers).toHaveLength(plans.length);
    for (const number of numbers) {
      expect(DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS).toContain(number);
    }
  });

  it("writes no seeded value in the vocabulary this interface has closed", async () => {
    const store = await seededStore();
    const [version] = await store.listPathwayVersions({ actor: coordinator });
    const plans = await store.listPlans({ actor: coordinator });
    const episodes = await Promise.all(
      plans.map((record) => store.getEpisode(toPlanId(record.plan.id), { actor: coordinator })),
    );

    const seededText = [
      ...version.snapshot.cadenceLabels,
      ...Object.values(version.snapshot.messageTextByType),
      ...episodes.flatMap((episode) => [
        episode?.patientName ?? "",
        episode?.culturalIdentity ?? "",
        ...(episode?.patientIdentifiers ?? []),
      ]),
    ];

    for (const text of seededText) {
      expect(text).not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
    }
  });

  // Round 2. The previous round of this seed advanced Week 1, Month 1 and Month 2 through the real
  // dispatch path while Rowan's plan was discharged only one day ago -- so all three of those
  // contacts' own scheduled days were still in the FUTURE, and the patient overview reported
  // messages already sent (two with a delivery receipt, one failed) for dates that had not
  // happened yet. Nothing in the write path caught this: `startContactDispatch` only checks that
  // the plan is active, never that the contact's own day has arrived, so a self-contradictory
  // timeline was structurally valid and every existing test above stayed green while seeding it.
  // This is the guard that specific defect needs: any contact whose state means the message
  // already left (`DISPATCHED_CONTACT_STATES` -- sent, delivered, or any provider exception) must
  // sit on or before the current AWST day, for every seeded plan, not only Rowan's.
  it("never advances a contact past scheduled while its own day is still in the future", async () => {
    const store = await seededStore();
    const today = awstCalendarDay(systemClock().now());
    const plans = await store.listPlans({ actor: coordinator });

    const dispatchedContacts = (
      await Promise.all(plans.map((record) => store.listContacts(toPlanId(record.plan.id), { actor: coordinator })))
    )
      .flat()
      .filter((entry) => DISPATCHED_CONTACT_STATES.includes(entry.contact.state));

    // Guards the guard: a population that dispatched nothing would satisfy the loop below by
    // checking nothing at all, exactly the Round 1, I4 trap the two tests above this one already
    // name. The seed's own module note promises three attempted contacts on Rowan's plan alone.
    expect(dispatchedContacts.length).toBeGreaterThan(0);

    for (const entry of dispatchedContacts) {
      expect(entry.planned.calendarDay <= today).toBe(true);
    }
  });
});
