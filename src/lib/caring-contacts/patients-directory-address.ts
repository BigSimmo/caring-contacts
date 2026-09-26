// src/lib/caring-contacts/patients-directory-address.ts
//
// SERVER-ONLY. Reads the full caseload directory address, including resolving an obfuscated
// `sft_` session filter token (#HDCF2B) back into a search query via `caseload-search-token.ts`,
// which stores that lookup in memory and mints tokens with `node:crypto`.
//
// This is split out of `patients-directory-filter.ts` deliberately: that module is imported by
// `patients-directory-client.tsx`, a `"use client"` component, and a client bundle that reaches
// `node:crypto` fails webpack outright (`UnhandledSchemeError: Reading from "node:crypto" is not
// handled by plugins`).
//
// This file deliberately does NOT depend on the "server" + "only" marker package used elsewhere
// in the repo, matching `caseload-search-token.ts` itself. `tests/caring-contacts-domain-
// isolation.test.ts` holds every file under this directory to an ALLOWLIST of import specifiers --
// relative imports and bare `node:` builtins only -- as proof that the whole `caring-contacts`
// domain is self-contained and provider-free. That marker package is neither, so adding it here
// would fail that test for no safety gain: the boundary this file exists to enforce is already
// structural. `patients-directory-filter.ts` never imports this module or
// `caseload-search-token.ts`, so nothing under `src/components/**` can reach `node:crypto` through
// this file no matter what marks it -- the import graph itself is the guard.
import { resolveSearchFilterToken } from "./caseload-search-token";
import {
  parsePatientsDirectoryFilter,
  PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM,
  PATIENTS_DIRECTORY_OVERLAY_PARAM,
  PATIENTS_DIRECTORY_RECOGNISED_PARAMS,
  PATIENTS_DIRECTORY_SEARCH_NOT_APPLIED_PARAM,
  type PatientsDirectoryFilter,
} from "./patients-directory-filter";
import type { CaringContactActor } from "./permissions";
import { CARING_CONTACTS_STATE_PARAM } from "./workspace-address";

/** What the address says, and what it should be rewritten to. Never carries a dropped VALUE. */
export type PatientsDirectoryAddress = {
  filter: PatientsDirectoryFilter;
  /**
   * True when the address carried at least one parameter this route does not understand. A
   * BOOLEAN, deliberately: not the name, not the value, not a count, not a length. Nothing that
   * narrows what the dropped term was may travel any further than this function.
   */
  droppedUnrecognisedParams: boolean;
  /** True when the address records that a saved search term was dropped on the way here. */
  searchNotApplied: boolean;
  /**
   * The query string this address should have had: recognised parameters only, in a fixed order,
   * `""` when there are none. It is built by NAMING what may be kept rather than by deleting what
   * may not, so a dropped value has no path into it even by accident.
   */
  canonicalQuery: string;
  /** Resolved search query from an obfuscated session filter token (#HDCF2B), if present. */
  searchQuery?: string;
  /** The obfuscated filter token itself, if present. */
  filterToken?: string;
};

/**
 * Read the address, and say what it should be rewritten to.
 *
 * WHY IGNORING THE PARAMETER WAS NOT ENOUGH. Declining to honour `?q=<name>` leaves the name in the
 * address bar, and `overlayUrl()` in `workspace-overlays.tsx` copies EVERY existing parameter into
 * each history entry it pushes -- so an ignored name was re-written into a fresh history entry
 * every time a coordinator opened an overlay. Not reading a value is not the same as removing it,
 * and on this page not reading it actively multiplied it.
 *
 * `actor` is who is looking NOW, not who searched. A `filterToken` is still an opaque id in a URL,
 * and a URL is exactly what a browser history entry, a Referer header, or a proxy access log
 * retains -- so this function must not treat "the token resolves" as "the current viewer may see
 * the query it names". `resolveSearchFilterToken` checks that `actor` is the one the token was
 * minted for AND currently holds `viewPatientRecord`; anyone else redeeming a replayed token gets
 * exactly the same outcome as an expired one -- `searchQuery` stays absent and the address is
 * rewritten to say a saved search term was not applied, never why.
 */
export function readPatientsDirectoryAddress(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  actor: CaringContactActor,
): PatientsDirectoryAddress {
  const filter = parsePatientsDirectoryFilter(searchParams);
  const rawFilterToken = searchParams[PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM];
  const filterToken = typeof rawFilterToken === "string" ? rawFilterToken : undefined;
  const searchQuery = filterToken ? (resolveSearchFilterToken(filterToken, actor) ?? undefined) : undefined;
  const invalidToken = Boolean(filterToken && !searchQuery);

  const droppedUnrecognisedParams =
    invalidToken || Object.keys(searchParams).some((key) => !PATIENTS_DIRECTORY_RECOGNISED_PARAMS.includes(key));
  const alreadyFlagged = typeof searchParams[PATIENTS_DIRECTORY_SEARCH_NOT_APPLIED_PARAM] === "string";
  const overlay = searchParams[PATIENTS_DIRECTORY_OVERLAY_PARAM];

  // Built from named recognised values only. `searchParams` is never spread, filtered or copied
  // into this, because a copy is how a value ends up somewhere nobody meant it to be.
  const kept = new URLSearchParams();
  if (filter.state !== "all") kept.set(CARING_CONTACTS_STATE_PARAM, filter.state);
  if (typeof overlay === "string") kept.set(PATIENTS_DIRECTORY_OVERLAY_PARAM, overlay);
  if (filterToken && searchQuery) kept.set(PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM, filterToken);
  if (droppedUnrecognisedParams || alreadyFlagged) kept.set(PATIENTS_DIRECTORY_SEARCH_NOT_APPLIED_PARAM, "1");

  return {
    filter,
    droppedUnrecognisedParams,
    searchNotApplied: droppedUnrecognisedParams || alreadyFlagged,
    canonicalQuery: kept.toString(),
    searchQuery,
    filterToken: searchQuery ? filterToken : undefined,
  };
}
