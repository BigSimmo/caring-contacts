// Standalone extract: new file, not a port. PsychSift's tests/proxy.test.ts covers its sign-in,
// mode-redirect, document-link and developer-area handling, none of which this copy's
// src/proxy.ts has. This file covers what the extract's proxy keeps: the cross-site block on API
// writes, the production closure of the design prototypes, and the nonce Content-Security-Policy.
// Requests are built the way PsychSift's proxy test builds them (a NextRequest on http://localhost).
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { signProductionSession } from "../src/lib/caring-contacts-server/session-token";
import { proxy, shouldBlockClosedWorkspace, shouldBlockProductionMockups } from "../src/proxy";

const PLANS_PATH = "/api/caring-contacts/plans";

function requestFor(path: string, init: { method?: string; headers?: Record<string, string> } = {}): NextRequest {
  return new NextRequest(new URL(`http://localhost${path}`), init);
}

/** NextResponse.next() marks a request that continues to the route; a proxy-made response does not. */
function continuedToRoute(response: Response): boolean {
  return response.headers.get("x-middleware-next") === "1";
}

function scriptSrcOf(csp: string): string {
  const directive = csp.split(";").find((d) => d.trim().startsWith("script-src"));
  if (!directive) throw new Error(`no script-src in CSP: ${csp}`);
  return directive.trim();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cross-site blocking on Caring Contacts API writes", () => {
  it("blocks a cross-site POST to the plans route with 403", async () => {
    const response = await proxy(
      requestFor(PLANS_PATH, { method: "POST", headers: { "sec-fetch-site": "cross-site" } }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_site_forbidden");
    expect(continuedToRoute(response)).toBe(false);
    expect(response.headers.get("content-security-policy")).toBeTruthy();
  });

  it("blocks a POST without Fetch Metadata whose Origin is another host", async () => {
    const response = await proxy(
      requestFor(PLANS_PATH, { method: "POST", headers: { origin: "https://attacker.example" } }),
    );
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("cross_site_forbidden");
  });

  it("passes a same-origin POST through to the route", async () => {
    const response = await proxy(
      requestFor(PLANS_PATH, {
        method: "POST",
        headers: { "sec-fetch-site": "same-origin", origin: "http://localhost" },
      }),
    );
    expect(response.status).not.toBe(403);
    expect(continuedToRoute(response)).toBe(true);
  });

  it("does not block a GET, even one marked cross-site", async () => {
    const response = await proxy(requestFor(PLANS_PATH, { headers: { "sec-fetch-site": "cross-site" } }));
    expect(response.status).not.toBe(403);
    expect(continuedToRoute(response)).toBe(true);
  });
});

describe("design prototypes under /mockups", () => {
  it("are 404 in a production build unless explicitly enabled", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_MOCKUPS_ENABLED", undefined);

    const response = await proxy(requestFor("/mockups/caring-contacts"));
    expect(response.status).toBe(404);
    expect(continuedToRoute(response)).toBe(false);
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-security-policy")).toBeTruthy();

    // Only the exact string "true" opens them.
    vi.stubEnv("CARING_CONTACTS_MOCKUPS_ENABLED", "1");
    expect((await proxy(requestFor("/mockups/caring-contacts"))).status).toBe(404);
  });

  it("open in a production build when CARING_CONTACTS_MOCKUPS_ENABLED=true", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_MOCKUPS_ENABLED", "true");

    const response = await proxy(requestFor("/mockups/caring-contacts"));
    expect(response.status).not.toBe(404);
    expect(continuedToRoute(response)).toBe(true);
  });

  it("are open in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("CARING_CONTACTS_MOCKUPS_ENABLED", undefined);

    const response = await proxy(requestFor("/mockups/caring-contacts"));
    expect(response.status).not.toBe(404);
    expect(continuedToRoute(response)).toBe(true);
  });

  it("closes only /mockups paths, matched on the segment boundary", () => {
    const production = { NODE_ENV: "production" };
    expect(shouldBlockProductionMockups("/mockups", production)).toBe(true);
    expect(shouldBlockProductionMockups("/mockups/caring-contacts/patients", production)).toBe(true);
    expect(shouldBlockProductionMockups("/mockupsx", production)).toBe(false);
    expect(shouldBlockProductionMockups("/caring-contacts", production)).toBe(false);
  });
});

describe("the workspace under /caring-contacts", () => {
  it("is a real 404 in a production build where the workspace is not switched on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", undefined);
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", undefined);
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", undefined);

    for (const path of ["/caring-contacts", "/caring-contacts/patients", "/caring-contacts/schedule"]) {
      const response = await proxy(requestFor(path));
      expect(response.status).toBe(404);
      expect(continuedToRoute(response)).toBe(false);
      expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(response.headers.get("content-security-policy")).toBeTruthy();
    }
  });

  it("stays open in a production build where the demo workspace is deliberately switched on", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "true");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "synthetic-secret");

    const response = await proxy(requestFor("/caring-contacts"));
    expect(response.status).not.toBe(404);
    expect(continuedToRoute(response)).toBe(true);
  });

  it("is open in development, and never touches paths that only share the prefix", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(continuedToRoute(await proxy(requestFor("/caring-contacts")))).toBe(true);

    const production = { NODE_ENV: "production" };
    expect(shouldBlockClosedWorkspace("/caring-contacts", production)).toBe(true);
    expect(shouldBlockClosedWorkspace("/caring-contacts/patients", production)).toBe(true);
    expect(shouldBlockClosedWorkspace("/caring-contactsx", production)).toBe(false);
    expect(shouldBlockClosedWorkspace("/api/caring-contacts/plans", production)).toBe(false);
    expect(shouldBlockClosedWorkspace("/mockups/caring-contacts", production)).toBe(false);
  });
});

describe("content-security-policy", () => {
  it("carries a fresh nonce on every response, and hands it to the route", async () => {
    const first = await proxy(requestFor("/caring-contacts"));
    const second = await proxy(requestFor("/caring-contacts"));
    const firstCsp = first.headers.get("content-security-policy");
    const secondCsp = second.headers.get("content-security-policy");
    expect(firstCsp).toBeTruthy();

    const firstNonce = scriptSrcOf(firstCsp!).match(/'nonce-([A-Za-z0-9+/=_-]+)'/)?.[1];
    const secondNonce = scriptSrcOf(secondCsp!).match(/'nonce-([A-Za-z0-9+/=_-]+)'/)?.[1];
    expect(firstNonce).toBeTruthy();
    expect(secondNonce).toBeTruthy();
    expect(firstNonce).not.toBe(secondNonce);

    // The request headers forwarded to the route carry the same nonce (Next.js exposes them as
    // x-middleware-request-* on the response), so the root layout's inline script can use it.
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(firstNonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(firstCsp);
  });

  it("uses the strict nonce policy outside development (no unsafe-inline or unsafe-eval)", async () => {
    // NODE_ENV is "test" here, so resolveRuntimeFlags() took the production branch at import.
    const csp = (await proxy(requestFor("/caring-contacts"))).headers.get("content-security-policy")!;
    const scriptSrc = scriptSrcOf(csp);
    expect(scriptSrc).toContain("'strict-dynamic'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

describe("live mode: workspace pages without a signed session go to staff sign-in", () => {
  const SECRET = "live-session-secret";

  function stubLiveMode() {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "false");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", SECRET);
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://example.invalid/caring_contacts");
    vi.stubEnv("CARING_CONTACTS_OIDC_REDIRECT_URL", "https://cc.example.test/api/caring-contacts/auth/callback");
  }

  function sessionCookie(expSeconds = Math.floor(Date.now() / 1000) + 3600, secret = SECRET): string {
    const value = signProductionSession(
      { actorId: "oidc:staff-1", teamId: "team-north", roles: ["coordinator"], exp: expSeconds },
      secret,
    );
    return `caring-contacts-production-session=${value}`;
  }

  it("redirects a page request with no session to sign-in, carrying where it was going", async () => {
    stubLiveMode();
    const response = await proxy(requestFor("/caring-contacts/patients?view=mine"));
    expect(response.status).toBe(307);
    expect(continuedToRoute(response)).toBe(false);
    const location = new URL(response.headers.get("location")!);
    expect(`${location.origin}${location.pathname}`).toBe("https://cc.example.test/api/caring-contacts/auth/sign-in");
    expect(location.searchParams.get("returnTo")).toBe("/caring-contacts/patients?view=mine");
  });

  it("redirects when the session is expired, forged, or signed with another secret", async () => {
    stubLiveMode();
    for (const cookie of [
      sessionCookie(Math.floor(Date.now() / 1000) - 60),
      sessionCookie(undefined, "some-other-secret"),
      "caring-contacts-production-session=v1.e30.forged",
      // The demo role cookie is never a live session.
      "caring-contacts-demo-role=teamLead",
    ]) {
      const response = await proxy(requestFor("/caring-contacts", { headers: { cookie } }));
      expect(response.status).toBe(307);
    }
  });

  it("lets a page request with a valid signed session through", async () => {
    stubLiveMode();
    const response = await proxy(requestFor("/caring-contacts/schedule", { headers: { cookie: sessionCookie() } }));
    expect(continuedToRoute(response)).toBe(true);
  });

  it("never redirects an API request: the route answers 401 session-required itself", async () => {
    stubLiveMode();
    const response = await proxy(requestFor("/api/caring-contacts/plans"));
    expect(continuedToRoute(response)).toBe(true);
    const signIn = await proxy(requestFor("/api/caring-contacts/auth/sign-in"));
    expect(continuedToRoute(signIn)).toBe(true);
  });

  it("leaves demo mode alone: no sign-in redirect", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "true");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "synthetic-secret");
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", undefined);
    const response = await proxy(requestFor("/caring-contacts"));
    expect(continuedToRoute(response)).toBe(true);
  });
});
