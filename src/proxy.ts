import { NextResponse, type NextRequest } from "next/server";

import { apiMutationCsrfVerdict, isCsrfGuardedApiRequest } from "@/lib/api-csrf";
import { OIDC_ENV, OIDC_SIGN_IN_PATH } from "@/lib/caring-contacts-server/oidc-config";
import {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  parseProductionSessionCookieValue,
} from "@/lib/caring-contacts-server/session-token";
import {
  isCaringContactsLiveEnabled,
  isCaringContactsWorkspaceEnabled,
} from "@/lib/caring-contacts-server/workspace-gate";
import { buildContentSecurityPolicy, resolveRuntimeFlags } from "@/lib/security-headers";

// Standalone extract: the Caring Contacts-relevant parts of PsychSift's src/proxy.ts. The
// original also handled PsychSift sign-in, mode redirects and document links, which are not
// part of this copy. What is kept runs on every request:
//
//   1. Content-Security-Policy with a fresh per-request nonce (see src/lib/security-headers.ts).
//   2. Cross-site request blocking on every API write (POST/PUT/PATCH/DELETE under /api/), using
//      Fetch Metadata plus an Origin/Referer host check (see src/lib/api-csrf.ts). No Caring
//      Contacts route does its own origin check, so this is the control that stops another site
//      from submitting changes on a signed-in user's behalf.
//   3. The design prototypes under /mockups are closed in a production build unless
//      CARING_CONTACTS_MOCKUPS_ENABLED=true. In PsychSift they sat behind an administrator
//      sign-in screen; this copy has no sign-in, so it fails closed instead.
//   4. The workspace pages under /caring-contacts answer a real 404 when the workspace is closed
//      (the same `isCaringContactsWorkspaceEnabled` test every page makes before `notFound()`).
//      Without this the page's own `notFound()` rendered the not-found screen with HTTP 200,
//      because the streamed response had already started. API routes answer 404 themselves.
//   5. In live mode, a workspace page requested without a valid signed session goes to staff
//      sign-in (src/app/api/caring-contacts/auth/sign-in) and comes back afterwards. API routes are
//      not redirected: they keep answering 401 `session-required` themselves.

const { isDevelopment, isLocalHttpRuntime } = resolveRuntimeFlags();

export function shouldBlockProductionMockups(
  pathname: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (pathname !== "/mockups" && !pathname.startsWith("/mockups/")) return false;
  if (environment.NODE_ENV !== "production") return false;
  return environment.CARING_CONTACTS_MOCKUPS_ENABLED !== "true";
}

export function shouldBlockClosedWorkspace(
  pathname: string,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (pathname !== "/caring-contacts" && !pathname.startsWith("/caring-contacts/")) return false;
  return !isCaringContactsWorkspaceEnabled(environment.NODE_ENV as typeof process.env.NODE_ENV, environment);
}

/** Live mode, a workspace page, and no valid signed session: the person must sign in first. */
export function shouldRedirectToSignIn(
  request: Pick<NextRequest, "method" | "nextUrl" | "cookies">,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  const { pathname } = request.nextUrl;
  if (pathname !== "/caring-contacts" && !pathname.startsWith("/caring-contacts/")) return false;
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  if (!isCaringContactsLiveEnabled(environment.NODE_ENV as typeof process.env.NODE_ENV, environment)) return false;
  const raw = request.cookies.get(CARING_CONTACTS_PRODUCTION_SESSION_COOKIE)?.value;
  return parseProductionSessionCookieValue(raw, environment) === null;
}

function publicOrigin(request: NextRequest): URL {
  try {
    return new URL(process.env[OIDC_ENV.redirectUrl] ?? "");
  } catch {
    return request.nextUrl;
  }
}

function notFoundResponse(csp: string): NextResponse {
  const response = new NextResponse("Not found", { status: 404 });
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildContentSecurityPolicy({ isDevelopment, isLocalHttpRuntime, nonce });

  if (shouldBlockProductionMockups(pathname) || shouldBlockClosedWorkspace(pathname)) {
    return notFoundResponse(csp);
  }

  if (shouldRedirectToSignIn(request)) {
    // Built on the configured public callback URL when there is one, so a reverse proxy's internal
    // host name never leaks into the redirect.
    const signIn = new URL(OIDC_SIGN_IN_PATH, publicOrigin(request));
    signIn.searchParams.set("returnTo", `${pathname}${request.nextUrl.search}`);
    const response = NextResponse.redirect(signIn, 307);
    response.headers.set("content-security-policy", csp);
    response.headers.set("cache-control", "no-store");
    return response;
  }

  if (isCsrfGuardedApiRequest(request.method, pathname)) {
    const verdict = apiMutationCsrfVerdict(request.headers, request.nextUrl.host);
    if (!verdict.allowed) {
      const response = NextResponse.json(
        { error: "Cross-site request blocked.", code: "cross_site_forbidden" },
        { status: 403 },
      );
      response.headers.set("content-security-policy", csp);
      return response;
    }
  }

  // Next.js reads the nonce from the request CSP header and stamps its own scripts; the root
  // layout reads `x-nonce` for the one hand-written inline script (the theme bootstrap).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  // API routes always run through the proxy, even when the last path segment looks like a
  // static image. Extension skips apply only to non-API assets.
  matcher: [
    "/api/:path*",
    "/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
