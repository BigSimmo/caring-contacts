// src/lib/caring-contacts-server/oidc-config.ts
//
// Staff sign-in settings for live mode, read from the environment alone. Pure: no network, no
// cookies, no "server-only", so the boot gate (src/instrumentation-node.ts) and the sign-in routes
// judge the same settings the same way. Only the variable NAMES ever appear in a problem message,
// never a value, because the client secret is one of them.
//
// Staff sign in through the organisation's own identity provider using standard OpenID Connect
// (authorization code flow with PKCE). The app keeps no passwords. Which Caring Contacts role and
// team a person gets is decided by their group memberships at the identity provider, through two
// maps the owner sets here; someone whose groups map to no role, or to no single team, is refused.
import type { CaringContactRole } from "@/lib/caring-contacts/permissions";

import { isDemoRole } from "./session-token";

export const OIDC_ENV = {
  /** The identity provider's issuer URL, exactly as its discovery document states it. */
  issuer: "CARING_CONTACTS_SESSION_ISSUER",
  clientId: "CARING_CONTACTS_OIDC_CLIENT_ID",
  clientSecret: "CARING_CONTACTS_OIDC_CLIENT_SECRET",
  /** Must be https://<this app>/api/caring-contacts/auth/callback, registered at the provider. */
  redirectUrl: "CARING_CONTACTS_OIDC_REDIRECT_URL",
  /** JSON object: group value -> role name, or a list of role names. */
  roleMap: "CARING_CONTACTS_OIDC_ROLE_MAP",
  /** JSON object: group value -> Caring Contacts team id. */
  teamMap: "CARING_CONTACTS_OIDC_TEAM_MAP",
  /** Optional. The ID token claim holding the groups; dotted paths allowed. Default `groups`. */
  groupsClaim: "CARING_CONTACTS_OIDC_GROUPS_CLAIM",
  /** Optional. Space-separated scopes; `openid` is always included. Default `openid`. */
  scopes: "CARING_CONTACTS_OIDC_SCOPES",
  /** Optional. Where the identity provider sends the browser after sign-out. */
  postLogoutRedirectUrl: "CARING_CONTACTS_OIDC_POST_LOGOUT_REDIRECT_URL",
} as const;

export const OIDC_CALLBACK_PATH = "/api/caring-contacts/auth/callback";
export const OIDC_SIGN_IN_PATH = "/api/caring-contacts/auth/sign-in";
export const OIDC_SIGN_OUT_PATH = "/api/caring-contacts/auth/sign-out";

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  scopes: string;
  groupsClaim: string;
  roleMap: ReadonlyMap<string, readonly CaringContactRole[]>;
  teamMap: ReadonlyMap<string, string>;
  postLogoutRedirectUrl: string | null;
};

export type OidcConfigResult = { ok: true; config: OidcConfig } | { ok: false; problems: string[] };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * https everywhere. Plain http is accepted only for a loopback address (the standard OAuth
 * exception, RFC 8252), which is what the offline test provider uses; nothing off this machine can
 * be reached that way.
 */
export function isAcceptableEndpointUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

function parseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readOidcConfig(runtime: Record<string, string | undefined> = process.env): OidcConfigResult {
  const problems: string[] = [];
  const read = (name: string) => runtime[name]?.trim() ?? "";

  const issuer = read(OIDC_ENV.issuer);
  if (!issuer) problems.push(`${OIDC_ENV.issuer} is not set (the identity provider's issuer URL).`);
  else if (!isAcceptableEndpointUrl(issuer)) problems.push(`${OIDC_ENV.issuer} must be an https URL.`);

  const clientId = read(OIDC_ENV.clientId);
  if (!clientId) problems.push(`${OIDC_ENV.clientId} is not set.`);
  const clientSecret = read(OIDC_ENV.clientSecret);
  if (!clientSecret) problems.push(`${OIDC_ENV.clientSecret} is not set.`);

  const redirectUrl = read(OIDC_ENV.redirectUrl);
  if (!redirectUrl) problems.push(`${OIDC_ENV.redirectUrl} is not set.`);
  else if (!isAcceptableEndpointUrl(redirectUrl) || new URL(redirectUrl).pathname !== OIDC_CALLBACK_PATH) {
    problems.push(`${OIDC_ENV.redirectUrl} must be an https URL ending in ${OIDC_CALLBACK_PATH}.`);
  }

  const postLogoutRedirectUrl = read(OIDC_ENV.postLogoutRedirectUrl) || null;
  if (postLogoutRedirectUrl && !isAcceptableEndpointUrl(postLogoutRedirectUrl)) {
    problems.push(`${OIDC_ENV.postLogoutRedirectUrl} must be an https URL when set.`);
  }

  const roleMap = new Map<string, CaringContactRole[]>();
  const rawRoles = read(OIDC_ENV.roleMap);
  const roleObject = rawRoles ? parseJsonObject(rawRoles) : null;
  if (!rawRoles) problems.push(`${OIDC_ENV.roleMap} is not set.`);
  else if (!roleObject) problems.push(`${OIDC_ENV.roleMap} must be a JSON object of group to role.`);
  else {
    for (const [group, value] of Object.entries(roleObject)) {
      const roles = Array.isArray(value) ? value : [value];
      if (!group.trim() || roles.length === 0 || !roles.every(isDemoRole)) {
        problems.push(
          `${OIDC_ENV.roleMap} has an entry whose role is not one of coordinator, teamLead, auditor, ` +
            "clinicalProgrammeLead, livedExperienceRepresentative.",
        );
        continue;
      }
      roleMap.set(group, roles as CaringContactRole[]);
    }
    if (roleMap.size === 0) problems.push(`${OIDC_ENV.roleMap} maps no group to a role.`);
  }

  const teamMap = new Map<string, string>();
  const rawTeams = read(OIDC_ENV.teamMap);
  const teamObject = rawTeams ? parseJsonObject(rawTeams) : null;
  if (!rawTeams) problems.push(`${OIDC_ENV.teamMap} is not set.`);
  else if (!teamObject) problems.push(`${OIDC_ENV.teamMap} must be a JSON object of group to team id.`);
  else {
    for (const [group, value] of Object.entries(teamObject)) {
      if (!group.trim() || typeof value !== "string" || !value.trim()) {
        problems.push(`${OIDC_ENV.teamMap} has an entry whose team id is not a non-empty string.`);
        continue;
      }
      teamMap.set(group, value.trim());
    }
    if (teamMap.size === 0) problems.push(`${OIDC_ENV.teamMap} maps no group to a team.`);
  }

  const scopeWords = new Set(["openid", ...read(OIDC_ENV.scopes).split(/\s+/).filter(Boolean)]);
  const groupsClaim = read(OIDC_ENV.groupsClaim) || "groups";

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      issuer,
      clientId,
      clientSecret,
      redirectUrl,
      scopes: [...scopeWords].join(" "),
      groupsClaim,
      roleMap,
      teamMap,
      postLogoutRedirectUrl,
    },
  };
}

/** Reads a claim by name, or by dotted path (`realm_access.roles`) for providers that nest it. */
function readClaim(claims: Record<string, unknown>, path: string): unknown {
  if (path in claims) return claims[path];
  let value: unknown = claims;
  for (const part of path.split(".")) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

export function groupsFromClaims(claims: Record<string, unknown>, groupsClaim: string): string[] {
  const value = readClaim(claims, groupsClaim);
  if (typeof value === "string") return value ? [value] : [];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item !== "");
  return [];
}

export type StaffMapping =
  | { ok: true; roles: CaringContactRole[]; teamId: string }
  | { ok: false; reason: "no-role" | "no-team" | "ambiguous-team" };

/**
 * Turns a verified ID token's claims into a role list and one team. Fails closed: no mapped role,
 * no mapped team, or groups naming two different teams all refuse, because guessing a team would
 * show one team's patients to another team's staff.
 */
export function mapClaimsToStaff(claims: Record<string, unknown>, config: OidcConfig): StaffMapping {
  const groups = groupsFromClaims(claims, config.groupsClaim);
  const roles = new Set<CaringContactRole>();
  const teams = new Set<string>();
  for (const group of groups) {
    for (const role of config.roleMap.get(group) ?? []) roles.add(role);
    const team = config.teamMap.get(group);
    if (team) teams.add(team);
  }
  if (roles.size === 0) return { ok: false, reason: "no-role" };
  if (teams.size === 0) return { ok: false, reason: "no-team" };
  if (teams.size > 1) return { ok: false, reason: "ambiguous-team" };
  return { ok: true, roles: [...roles], teamId: [...teams][0] };
}
