// src/lib/caring-contacts/caseload-search-token.ts
//
// Obfuscated session filter tokens for Caring Contacts caseload search (#HDCF2B).
//
// Prevents raw patient health information (PHI) and names from appearing in browser history,
// referer headers, or server access logs by replacing plaintext query parameters with
// opaque session filter tokens.
//
// Complies with Ruling [111]: "a query string is logged by every proxy between here and the browser.
// Nothing about a patient may travel here."
//
// THE TOKEN ITSELF IS NOT THE AUTHORIZATION BOUNDARY. An opaque token in a URL still travels
// everywhere a plaintext query would have -- browser history, a Referer header, a proxy access
// log -- so anyone who later obtains the URL from one of those places can replay it. Removing the
// PATIENT'S NAME from the log is the property this module buys; it does not, on its own, stop a
// replayed token from resolving. That second property comes from binding the token to the actor
// who minted it (their id and team, from the same demo-role identity every other Caring Contacts
// read is checked against) and re-checking, on every resolution, that the CURRENT actor is that
// same actor AND currently holds `viewPatientRecord` (`READ_ACTIONS.patientName`). A token replayed
// by anyone else -- a different role, a stale/removed grant, or no session at all -- resolves to
// null, exactly like an expired one, so the page treats it as a dropped search rather than as a
// name to render.

import { randomBytes } from "node:crypto";

import type { CaringContactActor } from "./permissions";
import { canPerformCaringContactAction, isSystemActor } from "./permissions";
import { READ_ACTIONS } from "./repository";

const TOKEN_PREFIX = "sft_";
export const DEFAULT_SEARCH_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes

type TokenEntry = {
  query: string;
  expiresAt: number;
  /** The actor who minted this token, so a resolution can require the SAME actor to redeem it. */
  ownerActorId: string;
  ownerTeamId: string;
};

/**
 * True when `actor` is the one this token entry was minted for. A system actor never mints or
 * redeems a search token -- caseload search is a human, interactive action -- so it is refused
 * here rather than compared by id, which would otherwise let a dispatcher-shaped actor id collide
 * with a human one.
 */
function isOwningActor(entry: TokenEntry, actor: CaringContactActor): boolean {
  if (isSystemActor(actor)) return false;
  return actor.id === entry.ownerActorId && actor.teamId === entry.ownerTeamId;
}

const tokenStore = new Map<string, TokenEntry>();

/**
 * Prunes expired tokens from the ephemeral store.
 */
function pruneExpiredTokens(now: number = Date.now()): void {
  for (const [token, entry] of tokenStore.entries()) {
    if (now > entry.expiresAt) {
      tokenStore.delete(token);
    }
  }
}

/**
 * Creates an obfuscated session filter token for a search query, bound to the actor who searched.
 * Produces an opaque, random token that contains ZERO patient identifiers or PHI.
 *
 * `actor` is stored alongside the query (id and team only, never a role list or anything else
 * identifying) so `resolveSearchFilterToken` can later refuse to redeem the token for anyone else.
 */
export function createSearchFilterToken(
  query: string,
  actor: CaringContactActor,
  options?: { ttlMs?: number; now?: number },
): string {
  const trimmed = query.trim();
  if (trimmed === "") return "";
  if (isSystemActor(actor)) return "";

  const now = options?.now ?? Date.now();
  pruneExpiredTokens(now);

  const ttlMs = options?.ttlMs ?? DEFAULT_SEARCH_TOKEN_TTL_MS;
  const id = randomBytes(16).toString("hex");
  const token = `${TOKEN_PREFIX}${id}`;

  tokenStore.set(token, {
    query: trimmed,
    expiresAt: now + ttlMs,
    ownerActorId: actor.id,
    ownerTeamId: actor.teamId,
  });

  return token;
}

/**
 * Resolves an obfuscated session filter token back into the search string -- but ONLY for the
 * actor it was minted for, and only while that actor currently holds `viewPatientRecord`
 * (`READ_ACTIONS.patientName`, the same capability every other patient-name read in this
 * workspace is checked against).
 *
 * Returns null if the token is invalid, expired, malformed, empty, minted for a different actor,
 * or the resolving actor no longer holds the name-view capability. Every one of those cases is
 * deliberately indistinguishable from the others to the caller: a stale grant and a replayed URL
 * both come back as "no search to apply", never as a reason that could itself leak something.
 */
export function resolveSearchFilterToken(
  token: string | null | undefined,
  actor: CaringContactActor,
  options?: { now?: number },
): string | null {
  if (!token || !token.startsWith(TOKEN_PREFIX)) return null;

  const now = options?.now ?? Date.now();
  const entry = tokenStore.get(token);

  if (!entry) {
    return null;
  }

  if (now > entry.expiresAt) {
    tokenStore.delete(token);
    return null;
  }

  if (!isOwningActor(entry, actor)) {
    return null;
  }

  const mayViewPatientNames = canPerformCaringContactAction(actor, READ_ACTIONS.patientName, {
    teamId: actor.teamId,
  }).allowed;
  if (!mayViewPatientNames) {
    return null;
  }

  return entry.query;
}

/**
 * Returns true if a string matches the format of an obfuscated search filter token
 * and resolves to a valid active search query for `actor`.
 */
export function isSearchFilterToken(value: unknown, actor: CaringContactActor, options?: { now?: number }): boolean {
  if (typeof value !== "string" || !value.startsWith(TOKEN_PREFIX)) return false;
  return resolveSearchFilterToken(value, actor, options) !== null;
}

/**
 * Clears all tokens from the ephemeral store (primarily for test isolation).
 */
export function clearSearchFilterTokenStore(): void {
  tokenStore.clear();
}
