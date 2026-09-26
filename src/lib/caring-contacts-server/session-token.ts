// src/lib/caring-contacts-server/session-token.ts
//
// The signed live-mode session cookie: how it is written and how it is checked. Split out of
// ./session so the request proxy (src/proxy.ts) can check a session before a workspace page
// renders, without importing `next/headers` or "server-only". It reads nothing but its arguments
// and the environment. ./session re-exports everything here, so existing callers are unchanged.
//
// The cookie is minted in exactly one place: the OpenID Connect callback
// (src/app/api/caring-contacts/auth/callback/route.ts, via ./oidc), after the identity
// provider's ID token has been verified and the staff member's groups mapped to a role and team.
import { createHmac, timingSafeEqual } from "node:crypto";

import { actorId, teamId } from "@/lib/caring-contacts/ids";
import type { Actor, CaringContactRole } from "@/lib/caring-contacts/permissions";

import { CARING_CONTACTS_SESSION_HMAC_SECRET_VAR } from "./workspace-gate";

export const CARING_CONTACTS_PRODUCTION_SESSION_COOKIE = "caring-contacts-production-session";

/** All five roles, in the order the demo switcher offers them. Also the only roles a live session may carry. */
export const DEMO_ROLES: readonly CaringContactRole[] = Object.freeze([
  "coordinator",
  "teamLead",
  "auditor",
  "clinicalProgrammeLead",
  "livedExperienceRepresentative",
]);

/** True for a value that names one of DEMO_ROLES. */
export function isDemoRole(value: unknown): value is CaringContactRole {
  return typeof value === "string" && (DEMO_ROLES as readonly string[]).includes(value);
}

export function productionSessionSecret(runtime: Record<string, string | undefined> = process.env): string | null {
  const value = runtime[CARING_CONTACTS_SESSION_HMAC_SECRET_VAR]?.trim();
  return value ? value : null;
}

export function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signaturesMatch(expected: string, provided: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ProductionSessionClaims = {
  actorId: string;
  teamId: string;
  roles: CaringContactRole[];
  exp: number;
};

/** Issues a signed production session cookie value for live sovereign mode. */
export function signProductionSession(claims: ProductionSessionClaims, secret: string): string {
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  const signature = signPayload(payload, secret);
  return `v1.${payload}.${signature}`;
}

export function parseProductionSessionCookieValue(
  raw: string | undefined,
  runtime: Record<string, string | undefined> = process.env,
  nowMs = Date.now(),
): Actor | null {
  if (!raw) return null;
  const secret = productionSessionSecret(runtime);
  if (!secret) return null;
  const parts = raw.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payload, signature] = parts;
  const expected = signPayload(payload, secret);
  if (!signaturesMatch(expected, signature)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<ProductionSessionClaims>;
    if (!claims.actorId || !claims.teamId || !Array.isArray(claims.roles) || typeof claims.exp !== "number") {
      return null;
    }
    if (claims.exp * 1000 < nowMs) return null;
    const roles = claims.roles.filter(isDemoRole);
    if (roles.length === 0) return null;
    return { id: actorId(claims.actorId), teamId: teamId(claims.teamId), roles };
  } catch {
    return null;
  }
}
