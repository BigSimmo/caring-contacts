// tests/caring-contacts-plan-draft.dom.test.tsx
//
// The activation wizard's draft — the half-finished sign-up the owner decided on 2026-08-25 must
// survive a page refresh and disappear when the tab closes (Ruling [110]).
//
// WHAT THIS FILE IS FOR, AND WHY IT LEANS ON THE CLEARING RATHER THAN THE WRITING. From stage 3
// onward the draft holds a patient's name and mobile number, on what is in practice a shared ward
// computer. A test that asserts the draft is WRITTEN is not a test that it is REMOVED, and the
// removal is the half that matters: if the write breaks, a clinician retypes a form; if a clear
// breaks, a patient's details sit on a ward machine after the clinician has gone. So every one of
// the three clearing paths has its own case here, and each was proved by breaking it and watching
// this file go red — the mutation log is in the Task 7 report.
//
// It is a `.dom.` file because `sessionStorage` needs a browser environment, not because it renders
// anything.
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stripSourceComments } from "./helpers/strip-source-comments";

import {
  PLAN_DRAFT_STORAGE_KEY,
  clearPlanDraft,
  emptyPlanDraft,
  isPlanDraftDirty,
  planDraftIsHeld,
  planDraftSnapshot,
  planDraftStorageAvailable,
  readPlanDraft,
  writePlanDraft,
  type PlanDraft,
} from "@/components/caring-contacts/workspace/plan-wizard/plan-draft";
import { DraftConcurrencyError } from "@/lib/caring-contacts/draft-store";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "@/lib/caring-contacts/synthetic-contacts";

const REFERRAL = "SYN-REFERRAL-001";
const OTHER_REFERRAL = "SYN-REFERRAL-002";

/**
 * A reserved fictional patient mobile, read from the sealed domain (round 1, M-4).
 *
 * This suite used to write one of the reserved numbers out as a literal, three times over, which is
 * exactly the second copy the sibling wizard suite's own comment refuses: a literal goes on passing
 * after the reserved numbers change, and a test pinning a number nobody reserves any more pins
 * nothing. (The number is not repeated here either -- a copy in prose is still a copy.)
 */
const RESERVED_PATIENT_MOBILE = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[1];

const WIZARD_DIRECTORY = path.join(process.cwd(), "src", "components", "caring-contacts", "workspace", "plan-wizard");

function filledDraft(referralId = REFERRAL): PlanDraft {
  return {
    ...emptyPlanDraft(referralId, "SYN-PATHWAY-001"),
    stage: "pathway",
    assurances: { patientAgreed: true, mobileIsPatientControlled: true },
  };
}

function storedRaw(): string | null {
  return window.sessionStorage.getItem(PLAN_DRAFT_STORAGE_KEY);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  // The store keeps module-level state (the in-memory fallback and the snapshot cache), and
  // clearing storage by hand does not touch it. Without this a test that leaves a draft in memory
  // hands it to the next one.
  clearPlanDraft();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearPlanDraft();
});

/**
 * Makes this browser behave like Safari private browsing: storage exists, `setItem` throws.
 *
 * Spied on `Storage.prototype`, not on `window.sessionStorage`. jsdom's storage object is a Proxy
 * whose `get` trap answers from the prototype, so an own-property spy on the instance is simply not
 * consulted — the first attempt at this test passed with the mock installed and never called, which
 * is the "check that cannot fail" shape. `expect(setItem).toHaveBeenCalled()` below is what stops
 * that recurring silently.
 */
function refuseWrites() {
  return vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("QuotaExceededError", "QuotaExceededError");
  });
}

describe("the caring-contacts plan draft — tab lifetime is enforced, not promised", () => {
  it("writes the draft to sessionStorage and leaves localStorage untouched", () => {
    expect(writePlanDraft(filledDraft())).toBe(true);

    expect(storedRaw(), "the draft was not written to sessionStorage").not.toBeNull();
    // `localStorage` outlives the tab, so a draft written there would leave a patient's details on
    // a shared ward computer indefinitely. Reading the whole store rather than one key: a widening
    // that used a different key would still be caught.
    expect(window.localStorage.length, "something was written to localStorage").toBe(0);
  });

  it("names no storage API but sessionStorage anywhere in the wizard", () => {
    // The enforcement Ruling [110] asks for is that the API cannot outlive the tab, not that a
    // comment says it will not. This scans the whole directory rather than the one module, because
    // a later stage could reach for `localStorage` directly from a component and never touch
    // `plan-draft.ts` at all.
    const files = readdirSync(WIZARD_DIRECTORY).flatMap((entry) => {
      const full = path.join(WIZARD_DIRECTORY, entry);
      return statSync(full).isFile() ? [full] : [];
    });
    expect(files.length, "the plan-wizard directory scanned to no files — update this test").toBeGreaterThan(0);

    // Comments are stripped first, and it is load-bearing rather than tidy: `plan-draft.ts`'s own
    // module note explains at length why `localStorage` is refused, and a scan that read prose
    // would report the explanation as the offence — then be "fixed" by deleting the explanation.
    // The same trap `tests/route-reachability.test.ts` records: documenting a rule is not breaking
    // it, and a check that cannot tell the two apart is a check that will be silenced.
    const offenders = files.filter((file) => stripSourceComments(readFileSync(file, "utf8")).includes("localStorage"));
    expect(offenders.map((file) => path.relative(process.cwd(), file))).toEqual([]);
  });

  it("gives the draft back after a reload, which is the whole reason it is written down", () => {
    writePlanDraft(filledDraft());

    // #M6P1QQ: `writePlanDraft` always writes back the version actually held, bumped by one, so a
    // single write against a fresh draft (nothing held yet -> version 0) lands as version 1.
    expect(readPlanDraft(REFERRAL)).toEqual({ ...filledDraft(), version: 1 });
  });

  it("clears on abandoning the flow, so a clinician who walks away leaves nothing behind", () => {
    writePlanDraft(filledDraft());
    expect(storedRaw()).not.toBeNull();

    clearPlanDraft();

    expect(storedRaw(), "the draft survived being discarded").toBeNull();
    expect(readPlanDraft(REFERRAL)).toBeNull();
  });

  it("offers ONE clearing seam, which is the one Task 9 must call on a successful activation", () => {
    // WHAT THIS PROVES, STATED EXACTLY — round 1, finding M-1. It proves the SEAM works: there is
    // one clearing function, so "cleared on activation" and "cleared on abandoning" cannot drift
    // apart into two implementations. It does NOT prove that Task 9 calls it, and it cannot: the
    // activation stage does not exist yet, so this case calls `clearPlanDraft()` directly and is
    // functionally the discard case under another name. The Task 7 report said it gave Task 9 "a
    // named, failing test to point at", which overstated it — a placeholder is not a guard, and the
    // claim has been corrected there rather than left standing.
    //
    // What DOES arm automatically when Task 9 builds the review stage is the case below.
    writePlanDraft(filledDraft());

    clearPlanDraft();

    expect(storedRaw(), "the one clearing seam left the draft on the machine").toBeNull();
  });

  it("removes a draft belonging to a different referral rather than merely ignoring it", () => {
    writePlanDraft(filledDraft(OTHER_REFERRAL));

    expect(readPlanDraft(REFERRAL), "another referral's draft was handed to this one").toBeNull();
    expect(storedRaw(), "another referral's draft was left in storage, referenced by nothing").toBeNull();
  });

  it("discards an unreadable draft rather than half-reading it", () => {
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, "{ not json");
    expect(readPlanDraft(REFERRAL)).toBeNull();
    expect(storedRaw()).toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ referralId: REFERRAL, stage: "not-a-stage", assurances: {}, pathwayVersionId: null }),
    );
    expect(readPlanDraft(REFERRAL), "a draft naming no real stage was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ referralId: REFERRAL, stage: "agreement", assurances: { patientAgreed: true } }),
    );
    expect(readPlanDraft(REFERRAL), "a draft missing half its assurances was accepted").toBeNull();
  });

  it("starts a fresh draft from the pathway the referral already names", () => {
    // Ruling [113]: an accepted referral can carry a pathway chosen by whoever accepted it, and a
    // draft that started from null would present that decision as though it had never been made.
    expect(emptyPlanDraft(REFERRAL, "SYN-PATHWAY-001").pathwayVersionId).toBe("SYN-PATHWAY-001");
    expect(emptyPlanDraft(REFERRAL, null).pathwayVersionId).toBeNull();
    expect(emptyPlanDraft(REFERRAL, null).assurances).toEqual({
      patientAgreed: false,
      mobileIsPatientControlled: false,
    });
    expect(emptyPlanDraft(REFERRAL, null).stage).toBe("agreement");
  });

  it("keeps the draft usable when the browser takes the object but refuses the write", () => {
    // Round 1, finding I-1, and the case is not exotic: Safari private browsing hands out a real
    // `sessionStorage` whose `setItem` throws. The earlier code reached for the in-memory fallback
    // only when the storage OBJECT was unavailable, so in this shape every tick was written to a
    // fallback nothing read, the snapshot stayed null, and the screen never changed — the exact
    // dead end the fallback exists to prevent.
    const setItem = refuseWrites();

    expect(writePlanDraft(filledDraft()), "a refused write reported success").toBe(false);
    expect(setItem, "the refusal was never actually exercised").toHaveBeenCalled();

    // #M6P1QQ: still version 1 -- the in-memory fallback goes through the same version bump as a
    // landed write, since a refused write must be usable for the rest of this page exactly as a
    // written one would be.
    expect(planDraftSnapshot(), "the refused write is invisible to the screen").toEqual({
      ...filledDraft(),
      version: 1,
    });
    expect(readPlanDraft(REFERRAL)).toEqual({ ...filledDraft(), version: 1 });
    // Nothing reached the tab-scoped store, so nothing outlives this page.
    expect(storedRaw()).toBeNull();
    // And the notice must say the draft is NOT being kept, rather than promising a memory the
    // browser refused.
    expect(planDraftIsHeld(), "the notice would have claimed the draft is kept").toBe(false);
  });

  it("goes back to keeping the draft once a write lands again", () => {
    refuseWrites();
    writePlanDraft(filledDraft());
    expect(planDraftIsHeld()).toBe(false);

    vi.restoreAllMocks();
    const later: PlanDraft = { ...filledDraft(), pathwayVersionId: "SYN-PATHWAY-002" };
    expect(writePlanDraft(later)).toBe(true);

    expect(planDraftIsHeld()).toBe(true);
    // #M6P1QQ: the failed write above already bumped the held (in-memory) version to 1, so this
    // one -- the first that actually lands in storage -- is version 2, not 1.
    expect(planDraftSnapshot(), "the stale in-memory draft shadowed the one that was stored").toEqual({
      ...later,
      version: 2,
    });
    expect(storedRaw()).not.toBeNull();
  });

  it("discards an in-memory draft too, so a refused browser is not a way to keep one", () => {
    refuseWrites();
    writePlanDraft(filledDraft());
    expect(planDraftSnapshot()).not.toBeNull();

    clearPlanDraft();

    expect(planDraftSnapshot(), "the discarded draft survived in memory").toBeNull();
  });

  it("reports storage as available here, so the wizard's notice is answering a real question", () => {
    expect(planDraftStorageAvailable()).toBe(true);
  });
});

describe("what stage 3 adds to the draft (Phase 2B Task 8)", () => {
  it("starts a fresh draft with nothing typed and no sending preference chosen", () => {
    // Nothing in this domain holds a patient's name or mobile number (Ruling [112]), so there is
    // nothing to prefill from. And nothing holds a sending preference either: the draft starts at
    // null rather than defaulting to "morning", because a default would make a choice about when a
    // discharged patient hears from the service and present it as though the coordinator had made
    // it. Stage 2's pathway differs only because a referral genuinely does carry one.
    const draft = emptyPlanDraft(REFERRAL, null);
    expect(draft.patientDetail).toEqual({
      patientName: "",
      preferredName: "",
      patientMobileNumber: "",
      patientIdentifiers: "",
      culturalIdentity: "",
    });
    expect(draft.sendingPreference).toBeNull();
  });

  it("keeps a patient's name, number and identifiers across a reload", () => {
    // The whole reason this workspace has a Client Component at all (Ruling [109]) — and the moment
    // Ruling [110]'s notice is about, because these are the values it is warning the clinician are
    // being held on this computer.
    const draft: PlanDraft = {
      ...filledDraft(),
      stage: "personalisation",
      patientDetail: {
        patientName: "Rowan Example",
        preferredName: "Rowan",
        patientMobileNumber: RESERVED_PATIENT_MOBILE,
        patientIdentifiers: ["SYN-MRN-4471", "SYN-URN-90210"].join("\n"),
        culturalIdentity: "Noongar",
      },
      sendingPreference: "earlyEvening",
    };
    expect(writePlanDraft(draft)).toBe(true);

    // Read back through the module's own PARSER, exactly as a reload would. `writePlanDraft`
    // primes the snapshot cache with the object it was handed -- that is what keeps the snapshot
    // referentially stable -- so a read straight after a write never touches `parseDraft` and would
    // prove only that the object is still in memory. Clearing the cache first is what makes this
    // about what SURVIVES storage.
    const serialised = JSON.stringify(draft);
    clearPlanDraft();
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, serialised);

    const read = readPlanDraft(REFERRAL);
    expect(read?.patientDetail.patientName).toBe("Rowan Example");
    // The name the messages open with survives too. It is asked for rather than split off the name
    // above, so losing it across a reload would mean asking the patient again -- or, worse, a
    // later "helpful" default reaching for the first word of the name above.
    expect(read?.patientDetail.preferredName).toBe("Rowan");
    expect(read?.patientDetail.patientMobileNumber).toBe(RESERVED_PATIENT_MOBILE);
    expect(read?.patientDetail.patientIdentifiers).toBe(draft.patientDetail.patientIdentifiers);
    expect(read?.sendingPreference).toBe("earlyEvening");

    // ROUND 2, N-1. Cultural identity does NOT survive, and that is the point: the screen no longer
    // offers an input for it, and a draft written before that change — same tab, across a redeploy —
    // would otherwise sail through `parseDraft` intact and be submitted at Task 9 into
    // `cultural_identity_reports`, while this very screen states that the plan records nothing
    // there. The blanking makes the screen's claim a property of CODE rather than of state.
    expect(
      read?.patientDetail.culturalIdentity,
      "a stored cultural identity survived a reload, so the screen's claim depends on nobody having one",
    ).toBe("");
  });

  it("blanks a stored cultural identity rather than discarding the whole draft (N-1)", () => {
    // Blanked, not REFUSED. Refusing the draft would throw away the patient's name and mobile
    // number the clinician typed — a real loss, to remove a field they were never offered. Blanking
    // drops exactly the value that may no longer be supplied and keeps everything they did type.
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        referralId: REFERRAL,
        stage: "personalisation",
        assurances: { patientAgreed: true, mobileIsPatientControlled: true },
        pathwayVersionId: "SYN-PATHWAY-001",
        patientDetail: {
          patientName: "Rowan Example",
          preferredName: "Rowan",
          patientMobileNumber: RESERVED_PATIENT_MOBILE,
          patientIdentifiers: "SYN-MRN-4471",
          culturalIdentity: "Noongar",
        },
        sendingPreference: "morning",
        // Stage 4's fields, present because `parseDraft` requires every field it knows about and
        // this case is about blanking ONE value, not about a draft written before stage 4 existed
        // -- that draft has its own case below.
        activation: { dischargeDay: "", firstContactDay: "", firstContactReason: "" },
        submission: null,
      }),
    );

    const read = readPlanDraft(REFERRAL);
    expect(read, "the draft was discarded when it only needed one field blanked").not.toBeNull();
    expect(read?.patientDetail.patientName).toBe("Rowan Example");
    expect(read?.patientDetail.culturalIdentity).toBe("");
  });

  it("discards a draft whose patient detail or sending preference is the wrong shape", () => {
    // `parseDraft` refuses anything it does not fully recognise, so a draft stored by an earlier
    // build — one with no patient detail at all — is discarded rather than half-read with the
    // clinician's typing silently defaulted away.
    const base = {
      referralId: REFERRAL,
      stage: "personalisation",
      assurances: { patientAgreed: true, mobileIsPatientControlled: true },
      pathwayVersionId: "SYN-PATHWAY-001",
    };

    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(base));
    expect(readPlanDraft(REFERRAL), "a draft from before stage 3 existed was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...base,
        patientDetail: { patientName: "Rowan Example", patientMobileNumber: RESERVED_PATIENT_MOBILE },
        sendingPreference: null,
      }),
    );
    expect(readPlanDraft(REFERRAL), "a draft missing half its patient detail was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...base,
        patientDetail: {
          patientName: "Rowan Example",
          preferredName: "Rowan",
          patientMobileNumber: RESERVED_PATIENT_MOBILE,
          patientIdentifiers: "",
          culturalIdentity: "",
        },
        sendingPreference: "whenever",
      }),
    );
    expect(readPlanDraft(REFERRAL), "a draft naming no real sending preference was accepted").toBeNull();
  });

  it("discards a draft written before the preferred name was asked for, rather than defaulting it", () => {
    // The module's own rule, applied to the newest field (2026-08-26): half a clinician's answers
    // with the other half silently defaulted is worse than asking again. Defaulting the preferred
    // name to `""` would be indistinguishable from a clinician who deliberately left it blank --
    // and the value decides the word a patient-visible message opens with.
    //
    // The cost is real and is accepted rather than glossed: the name and mobile number go with it.
    const withoutPreferredName = {
      referralId: REFERRAL,
      stage: "personalisation",
      assurances: { patientAgreed: true, mobileIsPatientControlled: true },
      pathwayVersionId: "SYN-PATHWAY-001",
      patientDetail: {
        patientName: "Rowan Example",
        patientMobileNumber: RESERVED_PATIENT_MOBILE,
        patientIdentifiers: "",
        culturalIdentity: "",
      },
      sendingPreference: "morning",
      activation: { dischargeDay: "", firstContactDay: "", firstContactReason: "" },
      submission: null,
    };

    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(withoutPreferredName));
    expect(readPlanDraft(REFERRAL), "a draft from before the preferred name existed was accepted").toBeNull();

    // Positive control on the SAME draft: adding only the missing field makes it readable, so the
    // refusal above is that one absence rather than anything else being wrong with this fixture.
    clearPlanDraft();
    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...withoutPreferredName,
        patientDetail: { ...withoutPreferredName.patientDetail, preferredName: "Rowan" },
      }),
    );
    expect(readPlanDraft(REFERRAL)?.patientDetail.preferredName).toBe("Rowan");
  });
});

describe("what stage 4 adds to the draft (Phase 2B Task 9)", () => {
  /** A draft filled in as far as the end of stage 3, ready for the review stage. */
  function readyForReview(): PlanDraft {
    return {
      ...filledDraft(),
      stage: "review",
      patientDetail: {
        patientName: "Rowan Example",
        preferredName: "Rowan",
        patientMobileNumber: RESERVED_PATIENT_MOBILE,
        patientIdentifiers: "",
        culturalIdentity: "",
      },
      sendingPreference: "morning",
    };
  }

  it("starts a fresh draft with no discharge day and no minted identifiers", () => {
    const draft = emptyPlanDraft(REFERRAL, null);
    // Empty rather than defaulted: a discharge day guessed from today's date would be a clinical
    // fact the screen invented, and every date in the plan is counted from it.
    expect(draft.activation).toEqual({ dischargeDay: "", firstContactDay: "", firstContactReason: "" });
    // Null rather than minted here. Ruling [120] mints at the moment stage 4 is REACHED, so a
    // sign-up abandoned at stage 1 never mints a plan identifier at all.
    expect(draft.submission).toBeNull();
  });

  it("keeps the discharge day, the first-contact day, its reason and the minted identifiers across a reload", () => {
    const draft: PlanDraft = {
      ...readyForReview(),
      activation: {
        dischargeDay: "2026-03-10",
        firstContactDay: "2026-03-17",
        firstContactReason: "The ward agreed this day with the patient before discharge.",
      },
      submission: {
        planId: "PLAN-abcdef",
        createIdempotencyKey: "PLAN-CREATE-abcdef",
        activateIdempotencyKey: "PLAN-START-abcdef",
      },
    };
    expect(writePlanDraft(draft)).toBe(true);

    // Through the module's own parser, exactly as a reload would — `writePlanDraft` primes the
    // snapshot cache with the object it was handed, so a read straight after a write proves only
    // that the object is still in memory.
    const serialised = JSON.stringify(draft);
    clearPlanDraft();
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, serialised);

    const read = readPlanDraft(REFERRAL);
    expect(read?.activation).toEqual(draft.activation);
    // THIS is the one that matters for Ruling [120]. A clinician whose Activate timed out reloads
    // the page and presses it again; if the identifiers did not survive, the retry would mint new
    // ones and create a SECOND plan for one patient rather than being refused as a replay.
    expect(
      read?.submission,
      "the minted plan identifier did not survive a reload, so a retry after a timeout would create a second plan",
    ).toEqual(draft.submission);
  });

  it("discards a draft whose stage-4 fields are missing or the wrong shape", () => {
    const base = {
      referralId: REFERRAL,
      stage: "review",
      assurances: { patientAgreed: true, mobileIsPatientControlled: true },
      pathwayVersionId: "SYN-PATHWAY-001",
      patientDetail: {
        patientName: "Rowan Example",
        preferredName: "Rowan",
        patientMobileNumber: RESERVED_PATIENT_MOBILE,
        patientIdentifiers: "",
        culturalIdentity: "",
      },
      sendingPreference: "morning",
    };

    // A draft written before stage 4 existed carries neither key. Half-reading it would put a
    // clinician back on the review stage with no discharge day and no identifiers, which is the
    // "half the answers, the rest silently defaulted" this parser refuses.
    window.sessionStorage.setItem(PLAN_DRAFT_STORAGE_KEY, JSON.stringify(base));
    expect(readPlanDraft(REFERRAL), "a draft from before stage 4 existed was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...base, activation: { dischargeDay: "2026-03-10" }, submission: null }),
    );
    expect(readPlanDraft(REFERRAL), "a draft missing two of its three activation fields was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...base,
        activation: { dischargeDay: "2026-03-10", firstContactDay: "", firstContactReason: "" },
        submission: { planId: "PLAN-abcdef" },
      }),
    );
    expect(readPlanDraft(REFERRAL), "a draft carrying half a minted identity was accepted").toBeNull();

    window.sessionStorage.setItem(
      PLAN_DRAFT_STORAGE_KEY,
      JSON.stringify({
        ...base,
        activation: { dischargeDay: "2026-03-10", firstContactDay: "", firstContactReason: "" },
        submission: {
          planId: "",
          createIdempotencyKey: "PLAN-CREATE-abcdef",
          activateIdempotencyKey: "PLAN-START-abcdef",
        },
      }),
    );
    expect(readPlanDraft(REFERRAL), "a draft carrying an empty plan identifier was accepted").toBeNull();
  });

  describe("isPlanDraftDirty — distinguishes pristine defaults from in-progress clinical drafts", () => {
    it("reports pristine/empty drafts as clean", () => {
      expect(isPlanDraftDirty(null, REFERRAL, null)).toBe(false);
      expect(isPlanDraftDirty(emptyPlanDraft(REFERRAL, null), REFERRAL, null)).toBe(false);
      expect(isPlanDraftDirty(emptyPlanDraft(REFERRAL, "PATHWAY-1"), REFERRAL, "PATHWAY-1")).toBe(false);
      // Different referral is not dirty for this referral
      expect(isPlanDraftDirty(emptyPlanDraft(OTHER_REFERRAL, null), REFERRAL, null)).toBe(false);
    });

    it("reports modified drafts as dirty", () => {
      const base = emptyPlanDraft(REFERRAL, null);

      expect(isPlanDraftDirty({ ...base, stage: "pathway" }, REFERRAL, null)).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, assurances: { patientAgreed: true, mobileIsPatientControlled: false } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(isPlanDraftDirty({ ...base, pathwayVersionId: "CHANGED-PATHWAY" }, REFERRAL, null)).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, patientDetail: { ...base.patientDetail, patientName: "Jane Doe" } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(
        isPlanDraftDirty({ ...base, patientDetail: { ...base.patientDetail, preferredName: "Jane" } }, REFERRAL, null),
      ).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, patientDetail: { ...base.patientDetail, patientMobileNumber: "0400000000" } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, patientDetail: { ...base.patientDetail, patientIdentifiers: "ID-123" } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(isPlanDraftDirty({ ...base, sendingPreference: "morning" }, REFERRAL, null)).toBe(true);
      expect(
        isPlanDraftDirty({ ...base, activation: { ...base.activation, dischargeDay: "2026-03-10" } }, REFERRAL, null),
      ).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, activation: { ...base.activation, firstContactDay: "2026-03-11" } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, activation: { ...base.activation, firstContactReason: "Discharge follow-up" } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
      expect(
        isPlanDraftDirty({ ...base, decisions: { ...base.decisions, identityChecked: true } }, REFERRAL, null),
      ).toBe(true);
      expect(
        isPlanDraftDirty(
          { ...base, decisions: { ...base.decisions, preferenceGivenOnStaffedLine: true } },
          REFERRAL,
          null,
        ),
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// #M6P1QQ: the version check is wired into THIS file's own writePlanDraft, the exact function the
// live plan wizard imports and calls -- not only into DraftStore's isolated, never-imported class
// (see tests/caring-contacts-draft-store.test.ts for that module in a vacuum). These tests exercise
// the real production entry point directly, proving a stale/concurrent save on the actual clinical
// draft path is caught rather than silently overwriting.
// ---------------------------------------------------------------------------

describe("the caring-contacts plan draft — optimistic concurrency on the real write path (#M6P1QQ)", () => {
  it("writes version 1 on the first save of a fresh draft, and increments on every save after", () => {
    expect(writePlanDraft(filledDraft())).toBe(true);
    expect(planDraftSnapshot()?.version).toBe(1);

    expect(writePlanDraft({ ...filledDraft(), stage: "personalisation" })).toBe(true);
    expect(planDraftSnapshot()?.version).toBe(2);
  });

  it("throws DraftConcurrencyError, not a silent overwrite, when the expected version is stale", () => {
    writePlanDraft(filledDraft()); // version 1

    // A write computed from version 1 loses the race to a write already at version 1 -- exactly the
    // shape of the same-tab race PlanDraft.version's module note describes: two writes built from
    // the same pre-commit render, one landing after the other already advanced the version.
    const staleChange = { ...filledDraft(), stage: "personalisation" as const };
    expect(() => writePlanDraft(staleChange, { expectedVersion: 0 })).toThrow(DraftConcurrencyError);

    // Nothing was clobbered: the draft actually held is still exactly what the first write left.
    expect(planDraftSnapshot()).toEqual({ ...filledDraft(), version: 1 });
  });

  it("the thrown error carries what is actually held, not what the failed write attempted, so a caller can re-base onto it", () => {
    writePlanDraft(filledDraft()); // version 1
    writePlanDraft({ ...filledDraft(), stage: "personalisation" }); // version 2, "personalisation"

    let caught: DraftConcurrencyError<PlanDraft> | undefined;
    try {
      writePlanDraft({ ...filledDraft(), stage: "review" }, { expectedVersion: 1 });
    } catch (error) {
      if (error instanceof DraftConcurrencyError) caught = error;
    }

    expect(caught).toBeDefined();
    expect(caught?.expectedVersion).toBe(1);
    expect(caught?.currentVersion).toBe(2);
    // The LIVE draft, not the caller's stale copy -- reads "personalisation" (what actually landed),
    // never "review" (what the failed write asked for) and never a version-1 snapshot.
    expect(caught?.currentDraft?.stage).toBe("personalisation");
    expect(caught?.currentDraft?.version).toBe(2);
  });

  it("succeeds when the expected version matches what is actually held", () => {
    writePlanDraft(filledDraft()); // version 1
    expect(() => writePlanDraft({ ...filledDraft(), stage: "personalisation" }, { expectedVersion: 1 })).not.toThrow();
    expect(planDraftSnapshot()?.version).toBe(2);
  });

  it("re-basing onto the live draft after a conflict never loses either write -- the retry pattern plan-wizard.tsx's writeDraftWithRetry follows", () => {
    // This is the exact shape of the fix: a caller whose write was refused re-reads the live draft
    // and re-applies its OWN change on top of it, rather than discarding either edit.
    const base = writePlanDraft(filledDraft()) && planDraftSnapshot()!; // version 1
    expect(base).toBeTruthy();
    if (!base) throw new Error("setup write did not land");

    // Someone else's write lands first (simulating the other half of the same-render race).
    writePlanDraft(
      { ...base, decisions: { ...base.decisions, identityChecked: true } },
      { expectedVersion: base.version },
    ); // version 2

    let live: PlanDraft;
    try {
      writePlanDraft({ ...base, stage: "personalisation" }, { expectedVersion: base.version });
      throw new Error("expected a DraftConcurrencyError");
    } catch (error) {
      if (!(error instanceof DraftConcurrencyError)) throw error;
      live = error.currentDraft as PlanDraft;
    }
    writePlanDraft({ ...live, stage: "personalisation" }, { expectedVersion: live.version });

    const settled = planDraftSnapshot();
    // BOTH edits survive: the identity check that landed first, and the stage change that retried.
    expect(settled?.decisions.identityChecked).toBe(true);
    expect(settled?.stage).toBe("personalisation");
    expect(settled?.version).toBe(3);
  });
});
