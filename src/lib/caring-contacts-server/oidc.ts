// src/lib/caring-contacts-server/oidc.ts
//
// Staff sign-in for live mode: a standard OpenID Connect relying party (authorization code flow
// with PKCE, state and nonce). It is the ONLY code that mints the signed live-mode session cookie.
//
//   sign-in  -> discover the provider, remember {state, nonce, PKCE verifier, return path} in a
//               short-lived signed cookie, and send the browser to the provider.
//   callback -> check state against that cookie, swap the code for tokens (with the PKCE verifier
//               and the client secret), verify the ID token's signature against the provider's
//               published keys (JWKS), its issuer, audience, expiry and nonce, map its groups to a
//               role and one team, and only then mint the session cookie.
//   sign-out -> clear the session cookie and, when the provider offers it, end the provider
//               session too so the next visit asks for credentials again.
//
// Every failure refuses and mints nothing. Logs carry a short reason code only: never a token, a
// code, a claim, a name or an email address.
import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, errors as joseErrors, jwtVerify, type JWTPayload } from "jose";
import { NextResponse, type NextRequest } from "next/server";

import { logger } from "@/lib/logger";

import {
  mapClaimsToStaff,
  OIDC_SIGN_IN_PATH,
  readOidcConfig,
  isAcceptableEndpointUrl,
  type OidcConfig,
} from "./oidc-config";
import {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  productionSessionSecret,
  signaturesMatch,
  signPayload,
  signProductionSession,
} from "./session-token";
import { isCaringContactsLiveEnabled } from "./workspace-gate";

/** How long a live session lasts before the person must sign in again: one working shift. */
export const LIVE_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
/** How long a person has to finish signing in at the provider. */
const SIGN_IN_FLOW_LIFETIME_SECONDS = 10 * 60;
export const OIDC_FLOW_COOKIE = "caring-contacts-oidc-flow";
const FLOW_COOKIE_PATH = "/api/caring-contacts/auth";
const DEFAULT_RETURN_PATH = "/caring-contacts";
const DISCOVERY_CACHE_MS = 60 * 60 * 1000;
const NETWORK_TIMEOUT_MS = 10_000;
/** Asymmetric algorithms only: `none` and shared-secret HS* are never accepted for an ID token. */
const ACCEPTED_ALGORITHMS = ["RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA"];

export type SignInRefusal =
  | "not-configured"
  | "provider-error"
  | "flow-missing"
  | "state-mismatch"
  | "discovery-failed"
  | "token-exchange-failed"
  | "id-token-invalid"
  | "id-token-bad-signature"
  | "id-token-expired"
  | "nonce-mismatch"
  | "no-role"
  | "no-team"
  | "ambiguous-team";

/** Response header naming why a sign-in was refused. A fixed code, never personal data. */
export const SIGN_IN_REFUSAL_HEADER = "x-caring-contacts-sign-in-refusal";

type ProviderMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
};

class SignInError extends Error {
  constructor(readonly reason: SignInRefusal) {
    super(reason);
    this.name = "SignInError";
  }
}

// ---------------------------------------------------------------------------------------------
// Discovery and keys, cached per issuer so a sign-in is not two extra round trips every time.

const discoveryCache = new Map<string, { metadata: ProviderMetadata; fetchedAt: number }>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

/** Test hook: forget every cached discovery document and key set. */
export function resetOidcCachesForTests(): void {
  discoveryCache.clear();
  jwksCache.clear();
}

async function discover(issuer: string): Promise<ProviderMetadata> {
  const cached = discoveryCache.get(issuer);
  if (cached && Date.now() - cached.fetchedAt < DISCOVERY_CACHE_MS) return cached.metadata;
  let body: Partial<ProviderMetadata>;
  try {
    const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) throw new SignInError("discovery-failed");
    body = (await response.json()) as Partial<ProviderMetadata>;
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError("discovery-failed");
  }
  // OpenID Connect Discovery §4.3: the document's issuer must be exactly the configured one.
  const endpoints = [body.authorization_endpoint, body.token_endpoint, body.jwks_uri];
  if (
    body.issuer !== issuer ||
    !endpoints.every((value) => typeof value === "string" && isAcceptableEndpointUrl(value))
  ) {
    throw new SignInError("discovery-failed");
  }
  const metadata = body as ProviderMetadata;
  if (metadata.end_session_endpoint && !isAcceptableEndpointUrl(metadata.end_session_endpoint)) {
    delete metadata.end_session_endpoint;
  }
  discoveryCache.set(issuer, { metadata, fetchedAt: Date.now() });
  return metadata;
}

function keysFor(jwksUri: string) {
  let keys = jwksCache.get(jwksUri);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(jwksUri), { timeoutDuration: NETWORK_TIMEOUT_MS });
    jwksCache.set(jwksUri, keys);
  }
  return keys;
}

// ---------------------------------------------------------------------------------------------
// The short-lived sign-in flow cookie: state, nonce, PKCE verifier and where to go afterwards.

type FlowState = { state: string; nonce: string; verifier: string; returnTo: string; exp: number };

function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function sealFlow(flow: FlowState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(flow), "utf8").toString("base64url");
  return `${payload}.${signPayload(`oidc-flow:${payload}`, secret)}`;
}

function openFlow(raw: string | undefined, secret: string, nowMs: number): FlowState | null {
  if (!raw) return null;
  const [payload, signature, extra] = raw.split(".");
  if (!payload || !signature || extra !== undefined) return null;
  if (!signaturesMatch(signPayload(`oidc-flow:${payload}`, secret), signature)) return null;
  try {
    const flow = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as FlowState;
    if (typeof flow.exp !== "number" || flow.exp * 1000 < nowMs) return null;
    if (![flow.state, flow.nonce, flow.verifier, flow.returnTo].every((v) => typeof v === "string" && v)) return null;
    return flow;
  } catch {
    return null;
  }
}

/**
 * Only a path inside the workspace may be returned to, so the sign-in route cannot be used to
 * bounce someone to another site. Anything else goes to the workspace home.
 */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return DEFAULT_RETURN_PATH;
  try {
    const url = new URL(value, "http://return-path.invalid");
    if (url.origin !== "http://return-path.invalid") return DEFAULT_RETURN_PATH;
    if (url.pathname !== "/caring-contacts" && !url.pathname.startsWith("/caring-contacts/"))
      return DEFAULT_RETURN_PATH;
    return `${url.pathname}${url.search}`;
  } catch {
    return DEFAULT_RETURN_PATH;
  }
}

// ---------------------------------------------------------------------------------------------
// Responses.

function noStore<T extends Response>(response: T): T {
  response.headers.set("cache-control", "no-store");
  return response;
}

const REFUSAL_COPY: Record<SignInRefusal, { status: number; message: string }> = {
  "not-configured": { status: 503, message: "Staff sign-in is not set up on this server." },
  "provider-error": { status: 400, message: "The sign-in service did not complete the sign-in." },
  "flow-missing": { status: 400, message: "This sign-in link has expired or was already used." },
  "state-mismatch": { status: 400, message: "This sign-in could not be matched to the one you started." },
  "discovery-failed": { status: 502, message: "The sign-in service could not be reached." },
  "token-exchange-failed": { status: 502, message: "The sign-in service did not confirm the sign-in." },
  "id-token-invalid": { status: 400, message: "The sign-in service's answer could not be checked." },
  "id-token-bad-signature": { status: 400, message: "The sign-in service's answer could not be checked." },
  "id-token-expired": { status: 400, message: "The sign-in took too long and has expired." },
  "nonce-mismatch": { status: 400, message: "The sign-in service's answer did not match this sign-in." },
  "no-role": {
    status: 403,
    message:
      "Your account is not assigned a Caring Contacts role. Ask your service lead to add you to the right group.",
  },
  "no-team": {
    status: 403,
    message:
      "Your account is not assigned a Caring Contacts team. Ask your service lead to add you to your team's group.",
  },
  "ambiguous-team": {
    status: 403,
    message: "Your account belongs to more than one Caring Contacts team. Ask your service lead to fix your groups.",
  },
};

function refusalResponse(reason: SignInRefusal, clearFlow: boolean): NextResponse {
  logger.warn("caring_contacts.sign_in_refused", { reason });
  const { status, message } = REFUSAL_COPY[reason];
  const retry = status === 403 ? "" : `<p><a href="${OIDC_SIGN_IN_PATH}">Try signing in again</a></p>`;
  const html =
    `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
    `<title>Sign-in refused · Caring Contacts</title></head><body><main><h1>Sign-in refused</h1>` +
    `<p>${message}</p>${retry}</main></body></html>`;
  const response = new NextResponse(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  response.headers.set(SIGN_IN_REFUSAL_HEADER, reason);
  if (clearFlow) response.cookies.set(OIDC_FLOW_COOKIE, "", { path: FLOW_COOKIE_PATH, maxAge: 0 });
  return noStore(response);
}

function notFound(): NextResponse {
  return noStore(NextResponse.json({ error: "Not found." }, { status: 404 }));
}

type ReadyConfig = { config: OidcConfig; secret: string };

/** Live mode on, sign-in fully configured, and the session secret present -- or a refusal. */
function readyConfig(): ReadyConfig | NextResponse {
  if (!isCaringContactsLiveEnabled()) return notFound();
  const result = readOidcConfig();
  const secret = productionSessionSecret();
  if (!result.ok || !secret) return refusalResponse("not-configured", false);
  return { config: result.config, secret };
}

// ---------------------------------------------------------------------------------------------
// The three steps.

export async function startSignIn(request: NextRequest, nowMs = Date.now()): Promise<NextResponse> {
  const ready = readyConfig();
  if (ready instanceof NextResponse) return ready;
  const { config, secret } = ready;
  let metadata: ProviderMetadata;
  try {
    metadata = await discover(config.issuer);
  } catch (error) {
    return refusalResponse(error instanceof SignInError ? error.reason : "discovery-failed", false);
  }

  const flow: FlowState = {
    state: randomToken(),
    nonce: randomToken(),
    verifier: randomToken(),
    returnTo: safeReturnPath(request.nextUrl.searchParams.get("returnTo")),
    exp: Math.floor(nowMs / 1000) + SIGN_IN_FLOW_LIFETIME_SECONDS,
  };
  const authorize = new URL(metadata.authorization_endpoint);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUrl);
  authorize.searchParams.set("scope", config.scopes);
  authorize.searchParams.set("state", flow.state);
  authorize.searchParams.set("nonce", flow.nonce);
  authorize.searchParams.set("code_challenge", pkceChallenge(flow.verifier));
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorize, 303);
  response.cookies.set(OIDC_FLOW_COOKIE, sealFlow(flow, secret), {
    httpOnly: true,
    secure: true,
    // Lax, not Strict: the provider's redirect back to the callback is a cross-site top-level
    // navigation, and Strict would withhold the cookie on exactly that request.
    sameSite: "lax",
    path: FLOW_COOKIE_PATH,
    maxAge: SIGN_IN_FLOW_LIFETIME_SECONDS,
  });
  return noStore(response);
}

async function exchangeCode(
  metadata: ProviderMetadata,
  config: OidcConfig,
  code: string,
  verifier: string,
): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUrl,
    code_verifier: verifier,
  });
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  // client_secret_basic is the OpenID Connect default; use client_secret_post only when the
  // provider says it does not take basic.
  const methods = metadata.token_endpoint_auth_methods_supported;
  if (methods && !methods.includes("client_secret_basic") && methods.includes("client_secret_post")) {
    form.set("client_id", config.clientId);
    form.set("client_secret", config.clientSecret);
  } else {
    const encode = (value: string) => encodeURIComponent(value);
    const basic = Buffer.from(`${encode(config.clientId)}:${encode(config.clientSecret)}`).toString("base64");
    headers.authorization = `Basic ${basic}`;
  }
  try {
    const response = await fetch(metadata.token_endpoint, {
      method: "POST",
      headers,
      body: form.toString(),
      signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) throw new SignInError("token-exchange-failed");
    const body = (await response.json()) as { id_token?: unknown };
    if (typeof body.id_token !== "string" || !body.id_token) throw new SignInError("token-exchange-failed");
    return body.id_token;
  } catch (error) {
    if (error instanceof SignInError) throw error;
    throw new SignInError("token-exchange-failed");
  }
}

async function verifyIdToken(
  idToken: string,
  metadata: ProviderMetadata,
  config: OidcConfig,
  nonce: string,
  nowMs: number,
): Promise<JWTPayload> {
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(idToken, keysFor(metadata.jwks_uri), {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ACCEPTED_ALGORITHMS,
      requiredClaims: ["sub", "exp", "iat"],
      clockTolerance: 60,
      currentDate: new Date(nowMs),
    }));
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) throw new SignInError("id-token-expired");
    if (error instanceof joseErrors.JWSSignatureVerificationFailed) throw new SignInError("id-token-bad-signature");
    throw new SignInError("id-token-invalid");
  }
  // OpenID Connect Core §3.1.3.7: with several audiences, the authorised party must be us.
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if ((audiences.length > 1 || payload.azp !== undefined) && payload.azp !== config.clientId) {
    throw new SignInError("id-token-invalid");
  }
  if (typeof payload.nonce !== "string" || !signaturesMatch(nonce, payload.nonce)) {
    throw new SignInError("nonce-mismatch");
  }
  if (typeof payload.sub !== "string" || !payload.sub.trim()) throw new SignInError("id-token-invalid");
  return payload;
}

export async function completeSignIn(request: NextRequest, nowMs = Date.now()): Promise<NextResponse> {
  const ready = readyConfig();
  if (ready instanceof NextResponse) return ready;
  const { config, secret } = ready;
  const params = request.nextUrl.searchParams;

  if (params.get("error")) return refusalResponse("provider-error", true);
  const flow = openFlow(request.cookies.get(OIDC_FLOW_COOKIE)?.value, secret, nowMs);
  if (!flow) return refusalResponse("flow-missing", true);
  const state = params.get("state") ?? "";
  const code = params.get("code") ?? "";
  if (!state || !signaturesMatch(flow.state, state)) return refusalResponse("state-mismatch", true);
  if (!code) return refusalResponse("provider-error", true);

  let claims: JWTPayload;
  try {
    const metadata = await discover(config.issuer);
    const idToken = await exchangeCode(metadata, config, code, flow.verifier);
    claims = await verifyIdToken(idToken, metadata, config, flow.nonce, nowMs);
  } catch (error) {
    return refusalResponse(error instanceof SignInError ? error.reason : "id-token-invalid", true);
  }

  const staff = mapClaimsToStaff(claims as Record<string, unknown>, config);
  if (!staff.ok) return refusalResponse(staff.reason, true);

  const exp = Math.floor(nowMs / 1000) + LIVE_SESSION_LIFETIME_SECONDS;
  const cookie = signProductionSession(
    { actorId: `oidc:${claims.sub as string}`, teamId: staff.teamId, roles: staff.roles, exp },
    secret,
  );
  // Relative to the configured callback URL, never to the Host header the request arrived with.
  const response = NextResponse.redirect(new URL(flow.returnTo, config.redirectUrl), 303);
  response.cookies.set(CARING_CONTACTS_PRODUCTION_SESSION_COOKIE, cookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: LIVE_SESSION_LIFETIME_SECONDS,
  });
  response.cookies.set(OIDC_FLOW_COOKIE, "", { path: FLOW_COOKIE_PATH, maxAge: 0 });
  logger.info("caring_contacts.sign_in_completed", { roles: staff.roles.length });
  return noStore(response);
}

export async function signOut(): Promise<NextResponse> {
  if (!isCaringContactsLiveEnabled()) return notFound();
  const result = readOidcConfig();
  let destination: URL | null = null;
  if (result.ok) {
    try {
      const metadata = await discover(result.config.issuer);
      if (metadata.end_session_endpoint) {
        destination = new URL(metadata.end_session_endpoint);
        destination.searchParams.set("client_id", result.config.clientId);
        if (result.config.postLogoutRedirectUrl) {
          destination.searchParams.set("post_logout_redirect_uri", result.config.postLogoutRedirectUrl);
        }
      }
    } catch {
      // The provider being unreachable must not stop the local session ending.
    }
  }
  // Without a provider sign-out, a redirect back into the workspace would bounce straight to the
  // provider and silently sign the person in again, so a plain page ends it here instead.
  const response = destination
    ? NextResponse.redirect(destination, 303)
    : new NextResponse(
        `<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="robots" content="noindex">` +
          `<title>Signed out · Caring Contacts</title></head><body><main><h1>You are signed out</h1>` +
          `<p><a href="${OIDC_SIGN_IN_PATH}">Sign in again</a></p></main></body></html>`,
        { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
      );
  response.cookies.set(CARING_CONTACTS_PRODUCTION_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return noStore(response);
}
