// tests/caring-contacts-search-privacy.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { demoActorForRole } from "@/lib/caring-contacts-server/session";
import {
  clearSearchFilterTokenStore,
  createSearchFilterToken,
  isSearchFilterToken,
  resolveSearchFilterToken,
} from "@/lib/caring-contacts/caseload-search-token";
import { readPatientsDirectoryAddress } from "@/lib/caring-contacts/patients-directory-address";
import {
  PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM,
  PATIENTS_DIRECTORY_RECOGNISED_PARAMS,
} from "@/lib/caring-contacts/patients-directory-filter";
import { POST as searchRoutePost } from "@/app/api/caring-contacts/patients/search/route";

// The route now resolves the caller's actor from the demo role cookie (via `resolveDemoActor`) to
// bind the minted token to it -- same mock shape `caring-contacts-session.test.ts` uses for the
// same reason: `cookies()` needs the Next request-scoped store this raw handler call has none of.
// An unset cookie falls back to the coordinator, matching `coordinator` below.
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => undefined })),
}));

// Every DEMO_ROLE holds `viewReferral` and `viewPatientRecord` together (see `permissions.ts`'s
// grant tables), so a coordinator is an ordinary actor that MAY redeem its own token -- exactly
// the case these tests other than the ownership ones want to exercise without also asserting the
// permission check.
const coordinator = demoActorForRole("coordinator");
const otherCoordinator = { ...coordinator, id: demoActorForRole("teamLead").id };
// Every DEMO_ROLE currently grants `viewPatientRecord` together with `viewReferral` (see
// `patients-directory.tsx`'s module note: "NO ROLE REACHES THE NOTICE TODAY" -- the grant tables
// never separate the two), so there is no real role today that mints a token and later lacks the
// name-view capability. `revokedCoordinator` stands in for "the same session, but the grant that
// was true when it searched is no longer true" -- same id and team, no roles at all -- so the live
// permission re-check inside `resolveSearchFilterToken` is exercised even though the specific
// `viewPatientRecord` grant it happens to be checking cannot itself be un-reachable through any
// role in the table today, same principle as that module's own "unreachable branch, pinned anyway".
const revokedCoordinator = { ...coordinator, roles: [] };

describe("Task 1 #HDCF2B: Patient privacy in caseload search (no PHI in URL / access logs)", () => {
  beforeEach(() => {
    clearSearchFilterTokenStore();
  });

  it("generates an opaque session filter token that does NOT expose raw patient names or base64 PHI", () => {
    const rawName = "Jordan Nguyen";
    const token = createSearchFilterToken(rawName, coordinator);

    expect(token).toMatch(/^sft_[a-f0-9]{32}$/);
    // Raw patient name must NOT appear in the token string in plaintext or trivial encoding
    expect(token).not.toContain("Jordan");
    expect(token).not.toContain("Nguyen");
    expect(token).not.toContain("jordan");
    expect(isSearchFilterToken(token, coordinator)).toBe(true);

    // Decoding the token string as base64 / utf8 never yields patient name
    const raw = token.slice(4);
    expect(Buffer.from(raw, "base64url").toString("utf8")).not.toContain("Jordan");

    // Resolves back to the query via server-side session store, for the actor who minted it
    const resolved = resolveSearchFilterToken(token, coordinator);
    expect(resolved).toBe(rawName);
  });

  it("handles empty or whitespace query cleanly", () => {
    expect(createSearchFilterToken("", coordinator)).toBe("");
    expect(createSearchFilterToken("   ", coordinator)).toBe("");
    expect(resolveSearchFilterToken("", coordinator)).toBeNull();
    expect(resolveSearchFilterToken(null, coordinator)).toBeNull();
    expect(resolveSearchFilterToken("sft_invalid-garbage", coordinator)).toBeNull();
  });

  it("enforces TTL expiration on search tokens", () => {
    const rawName = "Eleanor Vance";
    const baseTime = 1700000000000;
    const ttlMs = 60 * 1000; // 1 minute

    const token = createSearchFilterToken(rawName, coordinator, { ttlMs, now: baseTime });
    expect(resolveSearchFilterToken(token, coordinator, { now: baseTime + 30 * 1000 })).toBe(rawName);

    // After TTL, token must expire and return null
    expect(resolveSearchFilterToken(token, coordinator, { now: baseTime + 65 * 1000 })).toBeNull();
  });

  it("refuses to resolve a token for anyone other than the actor who minted it", () => {
    // The scenario the finding names directly: a token obtained from browser history, a Referer
    // header, or an access log -- by someone who is not the searching clinician -- must not
    // resolve, even though the token itself is well-formed and unexpired.
    const token = createSearchFilterToken("Jordan Nguyen", coordinator);

    expect(resolveSearchFilterToken(token, otherCoordinator)).toBeNull();
    expect(isSearchFilterToken(token, otherCoordinator)).toBe(false);

    // The owning actor can still redeem it.
    expect(resolveSearchFilterToken(token, coordinator)).toBe("Jordan Nguyen");
  });

  it("refuses to resolve a token for the owning actor once they no longer hold viewPatientRecord", () => {
    // Same actor id and team as the one the token was minted for, but no roles at all -- the live
    // permission check must refuse the redemption even though the ownership check alone would pass.
    const token = createSearchFilterToken("Jordan Nguyen", coordinator);
    expect(resolveSearchFilterToken(token, revokedCoordinator)).toBeNull();
  });

  it("refuses to mint or resolve a token for a system actor", () => {
    const dispatcher = { id: coordinator.id, teamId: coordinator.teamId, systemRole: "contactDispatcher" as const };
    expect(createSearchFilterToken("Jordan Nguyen", dispatcher)).toBe("");

    const token = createSearchFilterToken("Jordan Nguyen", coordinator);
    expect(resolveSearchFilterToken(token, dispatcher)).toBeNull();
  });

  it("recognises valid filterToken in address without triggering dropped-parameter redirect", () => {
    expect(PATIENTS_DIRECTORY_RECOGNISED_PARAMS).toContain(PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM);

    const token = createSearchFilterToken("Jordan Nguyen", coordinator);
    const address = readPatientsDirectoryAddress(
      {
        state: "active",
        [PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM]: token,
      },
      coordinator,
    );

    // Valid filterToken is recognised, so droppedUnrecognisedParams must be false
    expect(address.droppedUnrecognisedParams).toBe(false);
    expect(address.searchNotApplied).toBe(false);
    expect(address.searchQuery).toBe("Jordan Nguyen");
    expect(address.canonicalQuery).toContain(`filterToken=${encodeURIComponent(token)}`);
    // Crucially, the canonical query does not contain the raw name
    expect(address.canonicalQuery).not.toContain("Jordan");
    expect(address.canonicalQuery).not.toContain("Nguyen");
  });

  it("treats a token minted for a different actor the same as an expired one -- no query, no name", () => {
    const token = createSearchFilterToken("Jordan Nguyen", coordinator);
    const address = readPatientsDirectoryAddress(
      {
        state: "active",
        [PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM]: token,
      },
      otherCoordinator,
    );

    expect(address.droppedUnrecognisedParams).toBe(true);
    expect(address.searchNotApplied).toBe(true);
    expect(address.searchQuery).toBeUndefined();
    expect(address.canonicalQuery).not.toContain("filterToken");
    expect(address.canonicalQuery).not.toContain("Jordan");
    expect(address.canonicalQuery).not.toContain("Nguyen");
    expect(address.canonicalQuery).toBe("state=active&searchNotApplied=1");
  });

  it("drops expired or corrupted filterToken and sets searchNotApplied to clean the URL", () => {
    const corruptedToken = "sft_nonexistent_or_expired_12345";
    const address = readPatientsDirectoryAddress(
      {
        state: "active",
        [PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM]: corruptedToken,
      },
      coordinator,
    );

    // Expired/corrupted token must be dropped from canonical query
    expect(address.droppedUnrecognisedParams).toBe(true);
    expect(address.searchNotApplied).toBe(true);
    expect(address.searchQuery).toBeUndefined();
    expect(address.canonicalQuery).not.toContain("filterToken");
    expect(address.canonicalQuery).toBe("state=active&searchNotApplied=1");
  });

  it("drops raw GET query parameters (?q=, ?name=, ?search=) to prevent PHI in URL history", () => {
    const rawParams = [
      { q: "Jordan Nguyen" },
      { name: "Jordan Nguyen" },
      { search: "Jordan Nguyen" },
      { patient: "Jordan Nguyen" },
    ];

    for (const params of rawParams) {
      const address = readPatientsDirectoryAddress(params, coordinator);
      expect(address.droppedUnrecognisedParams).toBe(true);
      expect(address.searchNotApplied).toBe(true);
      // Canonical query must be clean of the unrecognised parameter
      expect(address.canonicalQuery).not.toContain("Jordan");
      expect(address.canonicalQuery).not.toContain("Nguyen");
      expect(address.canonicalQuery).toBe("searchNotApplied=1");
    }
  });

  it("POST /api/caring-contacts/patients/search receives body payload and returns filterToken bound to the caller", async () => {
    const request = new NextRequest("http://localhost/api/caring-contacts/patients/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "Sarah Connor",
        state: "active",
      }),
    });

    const response = await searchRoutePost(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.hasFilter).toBe(true);
    expect(json.filterToken).toMatch(/^sft_[a-f0-9]{32}$/);
    expect(json.filterToken).not.toContain("Sarah");
    expect(json.destination).toContain("state=active");
    expect(json.destination).toContain("filterToken=");
    expect(json.destination).not.toContain("Sarah");
    expect(json.destination).not.toContain("Connor");

    // The route resolves its own actor from the (mocked, unset -> coordinator) demo role cookie
    // and that actor can redeem the token it just minted; a DIFFERENT actor cannot, because the
    // route now binds the token to the actor who searched rather than to nobody in particular.
    expect(resolveSearchFilterToken(json.filterToken, coordinator)).toBe("Sarah Connor");
    expect(resolveSearchFilterToken(json.filterToken, otherCoordinator)).toBeNull();
  });

  describe("in live mode without a signed session", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    // Every other route turns a missing live session into the named 401 `session-required`; this one
    // resolved its actor unguarded, so the same condition left it as an unhandled exception.
    it("answers 401 session-required rather than throwing", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "false");
      vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "test-only-secret");
      vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://postgres@127.0.0.1:1/unused");

      const request = new NextRequest("http://localhost/api/caring-contacts/patients/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "Sarah Connor" }),
      });

      const response = await searchRoutePost(request);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ refusal: "session-required" });
    });
  });
});
