// Live-mode staff sign-in (OpenID Connect) end to end, against the offline mock provider in
// tests/helpers/mock-oidc-provider.ts. Each case drives the real route handlers: sign-in start ->
// the "browser" at the provider -> callback, and checks whether a signed session cookie was minted.
// The failure cases each make the provider misbehave in exactly one way and require that NO
// session cookie comes back.
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as callbackGET } from "../src/app/api/caring-contacts/auth/callback/route";
import { GET as signInGET } from "../src/app/api/caring-contacts/auth/sign-in/route";
import { POST as signOutPOST } from "../src/app/api/caring-contacts/auth/sign-out/route";
import { mapClaimsToStaff, readOidcConfig } from "../src/lib/caring-contacts-server/oidc-config";
import {
  LIVE_SESSION_LIFETIME_SECONDS,
  OIDC_FLOW_COOKIE,
  resetOidcCachesForTests,
  safeReturnPath,
  SIGN_IN_REFUSAL_HEADER,
} from "../src/lib/caring-contacts-server/oidc";
import {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  parseProductionSessionCookieValue,
} from "../src/lib/caring-contacts-server/session-token";
import { startMockOidcProvider, type AuthorizeOptions, type MockOidcProvider } from "./helpers/mock-oidc-provider";

const APP = "https://caring-contacts.example.test";
const SESSION_SECRET = "session-hmac-secret-for-tests";
let provider: MockOidcProvider;

function liveEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "production",
    CARING_CONTACTS_DEMO_ENABLED: "false",
    CARING_CONTACTS_DATABASE_URL: "postgres://example.invalid/caring_contacts",
    CARING_CONTACTS_SESSION_HMAC_SECRET: SESSION_SECRET,
    CARING_CONTACTS_SESSION_ISSUER: provider.issuer,
    CARING_CONTACTS_OIDC_CLIENT_ID: provider.clientId,
    CARING_CONTACTS_OIDC_CLIENT_SECRET: provider.clientSecret,
    CARING_CONTACTS_OIDC_REDIRECT_URL: `${APP}/api/caring-contacts/auth/callback`,
    CARING_CONTACTS_OIDC_ROLE_MAP: JSON.stringify({
      "cc-coordinators": "coordinator",
      "cc-leads": ["teamLead", "coordinator"],
    }),
    CARING_CONTACTS_OIDC_TEAM_MAP: JSON.stringify({ "cc-team-north": "team-north", "cc-team-south": "team-south" }),
    CARING_CONTACTS_OIDC_GROUPS_CLAIM: undefined,
    CARING_CONTACTS_OIDC_SCOPES: undefined,
    CARING_CONTACTS_OIDC_POST_LOGOUT_REDIRECT_URL: undefined,
    ...overrides,
  };
}

function stubEnv(env: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
}

function cookieFrom(response: Response, name: string): { value: string; attributes: string } | null {
  for (const header of response.headers.getSetCookie()) {
    const [pair, ...rest] = header.split(";");
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq).trim() === name) return { value: pair.slice(eq + 1), attributes: rest.join(";") };
  }
  return null;
}

async function startFlow(returnTo?: string) {
  const query = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const response = await signInGET(new NextRequest(`${APP}/api/caring-contacts/auth/sign-in${query}`));
  const flowCookie = cookieFrom(response, OIDC_FLOW_COOKIE);
  return { response, location: response.headers.get("location") ?? "", flowCookie: flowCookie?.value ?? "" };
}

async function callback(url: URL | string, flowCookie: string | null) {
  const headers: Record<string, string> = flowCookie ? { cookie: `${OIDC_FLOW_COOKIE}=${flowCookie}` } : {};
  return callbackGET(new NextRequest(url, { headers }));
}

async function fullSignIn(options: AuthorizeOptions = {}, returnTo?: string) {
  const started = await startFlow(returnTo);
  const back = provider.authorize(started.location, options);
  return callback(back, started.flowCookie);
}

function expectRefused(response: Response, status: number, reason: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get(SIGN_IN_REFUSAL_HEADER)).toBe(reason);
  expect(cookieFrom(response, CARING_CONTACTS_PRODUCTION_SESSION_COOKIE)).toBeNull();
}

beforeAll(async () => {
  provider = await startMockOidcProvider();
});

afterAll(async () => {
  await provider.close();
});

beforeEach(() => {
  resetOidcCachesForTests();
  stubEnv(liveEnv());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("staff sign-in: the happy path", () => {
  it("sends the browser to the provider with PKCE, state, nonce and the openid scope", async () => {
    const { response, location, flowCookie } = await startFlow("/caring-contacts/patients");
    expect(response.status).toBe(303);
    const url = new URL(location);
    expect(`${url.origin}${url.pathname}`).toBe(`${provider.issuer}/authorize`);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe(provider.clientId);
    expect(url.searchParams.get("redirect_uri")).toBe(`${APP}/api/caring-contacts/auth/callback`);
    expect(url.searchParams.get("scope")).toBe("openid");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("nonce")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).not.toBe(url.searchParams.get("nonce"));
    // The flow cookie carries the PKCE verifier, so it must never be readable by page script.
    expect(flowCookie).toBeTruthy();
    const attributes = cookieFrom(response, OIDC_FLOW_COOKIE)!.attributes.toLowerCase();
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("secure");
    expect(attributes).toContain("samesite=lax");
    expect(attributes).toContain("path=/api/caring-contacts/auth");
  });

  it("mints a signed session for a mapped staff member and returns them where they started", async () => {
    const before = Date.now();
    const response = await fullSignIn({}, "/caring-contacts/patients?view=mine");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${APP}/caring-contacts/patients?view=mine`);
    expect(provider.tokenRequests()).toBeGreaterThan(0);

    const session = cookieFrom(response, CARING_CONTACTS_PRODUCTION_SESSION_COOKIE);
    expect(session).not.toBeNull();
    const attributes = session!.attributes.toLowerCase();
    expect(attributes).toContain("httponly");
    expect(attributes).toContain("secure");
    expect(attributes).toContain(`max-age=${LIVE_SESSION_LIFETIME_SECONDS}`);

    const actor = parseProductionSessionCookieValue(session!.value, liveEnv());
    expect(actor).toEqual({ id: `oidc:${provider.subject}`, teamId: "team-north", roles: ["coordinator"] });
    // Expires with the shift, not before and not days later.
    expect(parseProductionSessionCookieValue(session!.value, liveEnv(), before + 7.9 * 3600_000)).not.toBeNull();
    expect(parseProductionSessionCookieValue(session!.value, liveEnv(), Date.now() + 8.1 * 3600_000)).toBeNull();
    // The one-time flow cookie is cleared.
    expect(cookieFrom(response, OIDC_FLOW_COOKIE)?.attributes.toLowerCase()).toContain("max-age=0");
  });

  it("combines the roles of every mapped group", async () => {
    const response = await fullSignIn({ claims: { groups: ["cc-leads", "cc-team-south", "unrelated"] } });
    const session = cookieFrom(response, CARING_CONTACTS_PRODUCTION_SESSION_COOKIE);
    const actor = parseProductionSessionCookieValue(session!.value, liveEnv());
    expect(actor?.teamId).toBe("team-south");
    expect([...(actor?.roles ?? [])].sort()).toEqual(["coordinator", "teamLead"]);
  });

  it("reads a nested groups claim when the provider nests it", async () => {
    stubEnv(liveEnv({ CARING_CONTACTS_OIDC_GROUPS_CLAIM: "realm_access.roles" }));
    const response = await fullSignIn({
      claims: { groups: undefined, realm_access: { roles: ["cc-coordinators", "cc-team-north"] } },
    });
    expect(cookieFrom(response, CARING_CONTACTS_PRODUCTION_SESSION_COOKIE)).not.toBeNull();
  });

  it("never logs a token, a code or a claim", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const started = await startFlow();
    const back = provider.authorize(started.location);
    await callback(back, started.flowCookie);
    await fullSignIn({ nonce: "wrong" });
    const logged = spies
      .flatMap((spy) => spy.mock.calls.flat())
      .map(String)
      .join("\n");
    // Not vacuous: the refusal IS logged, by its reason code alone.
    expect(logged).toContain("nonce-mismatch");
    expect(logged).not.toContain(provider.subject);
    expect(logged).not.toContain(back.searchParams.get("code")!);
    expect(logged).not.toContain(started.flowCookie);
    expect(logged).not.toContain("cc-coordinators");
    expect(logged).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });
});

describe("staff sign-in refuses and mints nothing", () => {
  it("when the state does not match the one the sign-in started with", async () => {
    const started = await startFlow();
    const back = provider.authorize(started.location);
    back.searchParams.set("state", "attacker-chosen-state");
    expectRefused(await callback(back, started.flowCookie), 400, "state-mismatch");
  });

  it("when there is no sign-in flow cookie (a callback nobody started here)", async () => {
    const started = await startFlow();
    expectRefused(await callback(provider.authorize(started.location), null), 400, "flow-missing");
  });

  it("when the flow cookie has been tampered with", async () => {
    const started = await startFlow();
    const back = provider.authorize(started.location);
    const [payload, signature] = started.flowCookie.split(".");
    const forged = `${payload}.${signature.replace(/.$/, (c) => (c === "A" ? "B" : "A"))}`;
    expectRefused(await callback(back, forged), 400, "flow-missing");
  });

  it("when the ID token carries a different nonce", async () => {
    expectRefused(await fullSignIn({ nonce: "replayed-nonce" }), 400, "nonce-mismatch");
  });

  it("when the ID token signature does not verify against the provider's published keys", async () => {
    expectRefused(await fullSignIn({ forgeSignature: true }), 400, "id-token-bad-signature");
  });

  it("when the ID token has expired", async () => {
    expectRefused(await fullSignIn({ expired: true }), 400, "id-token-expired");
  });

  it("when the ID token was issued to a different client", async () => {
    expectRefused(await fullSignIn({ audience: "some-other-app" }), 400, "id-token-invalid");
  });

  it("when the person's groups map to no Caring Contacts role", async () => {
    const response = await fullSignIn({ claims: { groups: ["cc-team-north", "finance"] } });
    expectRefused(response, 403, "no-role");
    expect(await response.text()).toContain("not assigned a Caring Contacts role");
  });

  it("when the person has a role but no team", async () => {
    expectRefused(await fullSignIn({ claims: { groups: ["cc-coordinators"] } }), 403, "no-team");
  });

  it("when the person's groups name two different teams", async () => {
    const groups = ["cc-coordinators", "cc-team-north", "cc-team-south"];
    expectRefused(await fullSignIn({ claims: { groups } }), 403, "ambiguous-team");
  });

  it("when the provider reports an error instead of a code", async () => {
    const started = await startFlow();
    const back = new URL(`${APP}/api/caring-contacts/auth/callback?error=access_denied&state=x`);
    expectRefused(await callback(back, started.flowCookie), 400, "provider-error");
  });

  it("when the code is replayed (the provider accepts each code once)", async () => {
    const started = await startFlow();
    const back = provider.authorize(started.location);
    expect((await callback(back, started.flowCookie)).status).toBe(303);
    expectRefused(await callback(back, started.flowCookie), 502, "token-exchange-failed");
  });

  it("when the client secret is wrong", async () => {
    stubEnv(liveEnv({ CARING_CONTACTS_OIDC_CLIENT_SECRET: "wrong-secret" }));
    expectRefused(await fullSignIn(), 502, "token-exchange-failed");
  });

  it("when the configured issuer is not the one the provider's discovery document names", async () => {
    stubEnv(liveEnv({ CARING_CONTACTS_SESSION_ISSUER: `${provider.issuer}/` }));
    const { response } = await startFlow();
    expect(response.status).toBe(502);
    expect(response.headers.get(SIGN_IN_REFUSAL_HEADER)).toBe("discovery-failed");
  });
});

describe("staff sign-in outside live mode", () => {
  it("does not exist in demo mode, so demo behaviour is unchanged", async () => {
    stubEnv({ NODE_ENV: "production", CARING_CONTACTS_DEMO_ENABLED: "true", CARING_CONTACTS_DATABASE_URL: undefined });
    expect((await startFlow()).response.status).toBe(404);
    expect((await callback(`${APP}/api/caring-contacts/auth/callback?code=x&state=y`, null)).status).toBe(404);
    expect((await signOutPOST()).status).toBe(404);
  });

  it("does not exist in development", async () => {
    stubEnv({ NODE_ENV: "development" });
    expect((await startFlow()).response.status).toBe(404);
  });

  it("answers 503 not-configured, rather than guessing, when live mode lacks sign-in settings", async () => {
    stubEnv(liveEnv({ CARING_CONTACTS_OIDC_CLIENT_ID: undefined }));
    const { response } = await startFlow();
    expect(response.status).toBe(503);
    expect(response.headers.get(SIGN_IN_REFUSAL_HEADER)).toBe("not-configured");
  });
});

describe("sign-out", () => {
  it("clears the session cookie and ends the provider session", async () => {
    stubEnv(liveEnv({ CARING_CONTACTS_OIDC_POST_LOGOUT_REDIRECT_URL: `${APP}/signed-out` }));
    const response = await signOutPOST();
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe(`${provider.issuer}/logout`);
    expect(location.searchParams.get("client_id")).toBe(provider.clientId);
    expect(location.searchParams.get("post_logout_redirect_uri")).toBe(`${APP}/signed-out`);
    const cleared = cookieFrom(response, CARING_CONTACTS_PRODUCTION_SESSION_COOKIE);
    expect(cleared?.value).toBe("");
    expect(cleared?.attributes.toLowerCase()).toContain("max-age=0");
  });
});

describe("return paths and settings", () => {
  it("only ever returns to a path inside the workspace", () => {
    expect(safeReturnPath("/caring-contacts/schedule?week=2")).toBe("/caring-contacts/schedule?week=2");
    for (const hostile of [
      "https://evil.example/caring-contacts",
      "//evil.example/caring-contacts",
      "/\\evil.example",
      "/api/caring-contacts/plans",
      "/caring-contactsx",
      "",
      null,
    ]) {
      expect(safeReturnPath(hostile)).toBe("/caring-contacts");
    }
  });

  it("names every missing setting, and never a value", () => {
    const result = readOidcConfig({ CARING_CONTACTS_OIDC_CLIENT_SECRET: "super-secret-value" });
    expect(result.ok).toBe(false);
    const text = result.ok ? "" : result.problems.join(" ");
    for (const name of [
      "CARING_CONTACTS_SESSION_ISSUER",
      "CARING_CONTACTS_OIDC_CLIENT_ID",
      "CARING_CONTACTS_OIDC_REDIRECT_URL",
      "CARING_CONTACTS_OIDC_ROLE_MAP",
      "CARING_CONTACTS_OIDC_TEAM_MAP",
    ]) {
      expect(text).toContain(name);
    }
    expect(text).not.toContain("CARING_CONTACTS_OIDC_CLIENT_SECRET");
    expect(text).not.toContain("super-secret-value");
  });

  it("refuses plain-http provider or callback URLs off this machine, an unknown role, and a wrong callback path", () => {
    const base = liveEnv();
    const check = (overrides: Record<string, string>) => readOidcConfig({ ...base, ...overrides });
    expect(check({ CARING_CONTACTS_SESSION_ISSUER: "http://sso.example.test" }).ok).toBe(false);
    expect(
      check({ CARING_CONTACTS_OIDC_REDIRECT_URL: "http://app.example.test/api/caring-contacts/auth/callback" }).ok,
    ).toBe(false);
    expect(check({ CARING_CONTACTS_OIDC_REDIRECT_URL: `${APP}/somewhere-else` }).ok).toBe(false);
    expect(check({ CARING_CONTACTS_OIDC_ROLE_MAP: JSON.stringify({ admins: "administrator" }) }).ok).toBe(false);
    expect(check({ CARING_CONTACTS_OIDC_ROLE_MAP: "not json" }).ok).toBe(false);
    expect(check({ CARING_CONTACTS_OIDC_TEAM_MAP: JSON.stringify({ g: "" }) }).ok).toBe(false);
    expect(readOidcConfig(base).ok).toBe(true);
  });

  it("maps a single string groups claim", () => {
    const result = readOidcConfig(liveEnv());
    if (!result.ok) throw new Error("expected valid settings");
    expect(mapClaimsToStaff({ groups: "cc-coordinators" }, result.config)).toEqual({ ok: false, reason: "no-team" });
  });
});
