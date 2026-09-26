// src/lib/caring-contacts-server/session.ts
//
// The demo role switcher. The decision lock requires WA Health enterprise sign-on and states that
// no Caring-Contacts-local credentials exist, so this is deliberately NOT a login and must never
// look like one -- it is a role switcher, labelled as one, that exists because the permission and
// auditor surfaces cannot be demonstrated without it.
//
// The cookie it reads holds only a role name, never a credential. Anything unreadable -- no
// cookie, an empty value, a name that is not one of DEMO_ROLES -- falls back to the coordinator
// rather than throwing: an unreadable cookie must never lock someone out of a demonstration.
//
// Production sovereign deployments may open the workspace when a session HMAC secret is
// configured (`CARING_CONTACTS_SESSION_HMAC_SECRET`). That secret gates the demo/live env flags;
// it does not authenticate a human. Demo staging sets `CARING_CONTACTS_DEMO_ENABLED=true` and
// still uses forgeable/default demo role actors (HMAC only stops offline role-cookie forgery).
// Live mode sets the flag to `false`, requires a signed production session cookie (minted only by
// the OpenID Connect sign-in in ./oidc, after the identity provider's ID token is verified), and
// requires pilot governance attestation at boot (see instrumentation.register). Demo mode must not bind
// to CARING_CONTACTS_DATABASE_URL (store refuses that pairing).
import "server-only";

import { cookies } from "next/headers";

import { actorId, teamId, type TeamId } from "@/lib/caring-contacts/ids";
import type { Actor, CaringContactRole, SystemActor } from "@/lib/caring-contacts/permissions";

import {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  isDemoRole,
  parseProductionSessionCookieValue,
  productionSessionSecret,
  signaturesMatch,
  signPayload,
} from "./session-token";
import { isCaringContactsDemoEnabled, isCaringContactsLiveEnabled } from "./workspace-gate";

export const CARING_CONTACTS_ROLE_COOKIE = "caring-contacts-demo-role";
// The signed live-mode session cookie lives in ./session-token so the request proxy can check it
// without "server-only"; everything it exports is re-exported here unchanged.
export {
  CARING_CONTACTS_PRODUCTION_SESSION_COOKIE,
  DEMO_ROLES,
  isDemoRole,
  parseProductionSessionCookieValue,
  productionSessionSecret,
  signProductionSession,
  type ProductionSessionClaims,
} from "./session-token";
export {
  CARING_CONTACTS_DATABASE_URL_VAR,
  CARING_CONTACTS_DEMO_ENABLED_VAR,
  CARING_CONTACTS_SESSION_HMAC_SECRET_VAR,
  hasProductionSessionSecret,
  isCaringContactsDemoEnabled,
  isCaringContactsLiveEnabled,
  isCaringContactsWorkspaceEnabled,
} from "./workspace-gate";

/** Thrown when code tries to resolve a demo actor in a production process. */
export class CaringContactsDemoUnavailableError extends Error {
  constructor() {
    super("Caring Contacts demo actors are unavailable in production.");
    this.name = "CaringContactsDemoUnavailableError";
  }
}

/** Thrown when live mode cannot resolve a signed production session. */
export class CaringContactsProductionSessionError extends Error {
  constructor(message = "Caring Contacts production session is unavailable.") {
    super(message);
    this.name = "CaringContactsProductionSessionError";
  }
}

const DEFAULT_DEMO_ROLE: CaringContactRole = "coordinator";

/** The one team every demo actor belongs to -- there is no multi-team demo. */
export const DEMO_TEAM_ID: TeamId = teamId("demo-team");

/** The actor id names the acting role, e.g. `demo-auditor`, so the audit trail can show it. */
export function demoActorForRole(role: CaringContactRole): Actor {
  return { id: actorId(`demo-${role}`), teamId: DEMO_TEAM_ID, roles: [role] };
}

/**
 * The system actor demo contact-dispatch writes are attributed to.
 *
 * `SystemActor` exists in `./permissions` for one reason: a contact's provider status is written
 * by the dispatcher and by nothing else, so software needs an attributable, non-human author for
 * that write. `contactDispatcher`'s grant table and every human role's grant table never overlap
 * (pinned by a permissions test), so this actor can never acquire a human capability and no human
 * demo role can ever acquire this one -- a coordinator cannot be handed `startContactDispatch`
 * just because the population needs a few contacts to look attempted. The demo population's own
 * dispatch writes go through this actor for exactly the same reason the real dispatcher would.
 */
export function demoSystemDispatcher(): SystemActor {
  return { id: actorId("demo-system-dispatcher"), teamId: DEMO_TEAM_ID, systemRole: "contactDispatcher" };
}

/** Signs a demo role for production sovereign demo mode. */
export function signDemoRoleCookie(role: CaringContactRole, secret: string): string {
  const signature = signPayload(`role:${role}`, secret);
  return `${role}.${signature}`;
}

/** Parses a demo role cookie, verifying the HMAC when a production session secret is configured. */
export function parseDemoRoleCookieValue(
  raw: string | undefined,
  runtime: Record<string, string | undefined> = process.env,
): CaringContactRole {
  if (!raw) return DEFAULT_DEMO_ROLE;
  const secret = productionSessionSecret(runtime);
  if (!secret) {
    // Non-production (or Playwright) path: unsigned role name is accepted.
    return isDemoRole(raw) ? raw : DEFAULT_DEMO_ROLE;
  }
  const separator = raw.lastIndexOf(".");
  if (separator <= 0) return DEFAULT_DEMO_ROLE;
  const role = raw.slice(0, separator);
  const signature = raw.slice(separator + 1);
  if (!isDemoRole(role)) return DEFAULT_DEMO_ROLE;
  const expected = signPayload(`role:${role}`, secret);
  return signaturesMatch(expected, signature) ? role : DEFAULT_DEMO_ROLE;
}

/**
 * Reads the demo role cookie and resolves the actor it names. Falls back to the coordinator for
 * anything unreadable rather than throwing -- see the module note above. That includes the read
 * itself failing (`cookies()` rejecting, or `.get()` throwing), not only an unrecognised value:
 * a caller that let either propagate would produce exactly the locked-out-of-a-demonstration
 * outcome this fallback exists to prevent.
 */
export async function resolveDemoActor(): Promise<Actor> {
  if (!isCaringContactsDemoEnabled()) throw new CaringContactsDemoUnavailableError();
  const role = await readDemoRoleCookie();
  return demoActorForRole(role);
}

/** Resolves the live sovereign actor from the signed production session cookie. */
export async function resolveProductionActor(): Promise<Actor> {
  if (!isCaringContactsLiveEnabled()) {
    throw new CaringContactsProductionSessionError("Caring Contacts live mode is not enabled.");
  }
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(CARING_CONTACTS_PRODUCTION_SESSION_COOKIE)?.value;
    const actor = parseProductionSessionCookieValue(raw);
    if (!actor) {
      throw new CaringContactsProductionSessionError(
        "Caring Contacts live mode requires a signed production session cookie issued by enterprise SSO.",
      );
    }
    return actor;
  } catch (error) {
    if (error instanceof CaringContactsProductionSessionError) throw error;
    throw new CaringContactsProductionSessionError("Caring Contacts production session cookie could not be read.");
  }
}

/** Resolves the acting actor for whichever workspace mode is enabled. */
export async function resolveCaringContactsActor(): Promise<Actor> {
  if (isCaringContactsDemoEnabled()) return resolveDemoActor();
  if (isCaringContactsLiveEnabled()) return resolveProductionActor();
  throw new CaringContactsDemoUnavailableError();
}

async function readDemoRoleCookie(): Promise<CaringContactRole> {
  try {
    const cookieStore = await cookies();
    const raw = cookieStore.get(CARING_CONTACTS_ROLE_COOKIE)?.value;
    return parseDemoRoleCookieValue(raw);
  } catch {
    return DEFAULT_DEMO_ROLE;
  }
}
