import type { PlanState } from "./model";
import {
  CARING_CONTACTS_OVERLAY_PARAM,
  CARING_CONTACTS_SEARCH_NOT_APPLIED_PARAM,
  CARING_CONTACTS_STATE_PARAM,
} from "./workspace-address";

/**
 * CLIENT-SAFE BY CONSTRUCTION.
 *
 * `patients-directory-client.tsx` (a `"use client"` component) imports
 * `PATIENTS_DIRECTORY_STATE_ORDER` and `PatientsDirectoryFilter` from this file, so nothing here
 * may import `node:crypto` or anything that transitively does. `readPatientsDirectoryAddress` --
 * the one piece of this domain that resolves an obfuscated `sft_` token and therefore needs the
 * server-only token store -- lives in `patients-directory-address.ts` instead, which imports the
 * client-safe declarations below rather than the other way around. Keep it that way: pulling
 * `caseload-search-token.ts` back into this file re-creates webpack's
 * `UnhandledSchemeError: Reading from "node:crypto"` for every client bundle that reaches here.
 */

/** Every plan state, in lifecycle order, as the directory filter offers them. */
export const PATIENTS_DIRECTORY_STATE_ORDER: readonly PlanState[] = Object.freeze([
  "draft",
  "active",
  "paused",
  "completed",
  "withdrawn",
  "cancelled",
]);

export type PatientsDirectoryStateFilter = PlanState | "all";

export type PatientsDirectoryFilter = {
  /** The plan state the URL asks for, already validated; "all" when absent or unrecognised. */
  state: PatientsDirectoryStateFilter;
};

/**
 * Parse only non-identifying state from the URL; patient-name search stays in browser memory.
 *
 * The absence of a `q` parameter here is the contract, not an omission. A caseload search matches
 * the patient's NAME, and Ruling [111] does not allow one into a query string -- "a query string is
 * logged by every proxy between here and the browser. Nothing about a patient may travel here." The
 * directory's client island holds the typed text and this function has nowhere to put it, so a
 * stale `?q=` on an old bookmark is ignored rather than honoured.
 *
 * A repeated `?state=a&state=b` arrives as an array and names no single state. Both that and an
 * unrecognised value fall back to "all" rather than throwing: a mistyped URL must widen the list,
 * never fail the render or hide a caseload behind an error page.
 */
export function parsePatientsDirectoryFilter(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
): PatientsDirectoryFilter {
  const rawState = searchParams.state;
  const state: PatientsDirectoryStateFilter =
    typeof rawState === "string" && (PATIENTS_DIRECTORY_STATE_ORDER as readonly string[]).includes(rawState)
      ? (rawState as PlanState)
      : "all";

  return { state };
}

/**
 * The parameter that records, in the address, that a saved search term was dropped.
 *
 * Non-identifying by construction: it is a flag, never the term. It exists because the fix for the
 * dropped term is a server REDIRECT, and a redirect has no other way to carry "something was
 * removed" to the screen it lands on. It is itself recognised, which is what stops the redirect
 * target from being unrecognised in its turn and looping forever.
 */
export const PATIENTS_DIRECTORY_SEARCH_NOT_APPLIED_PARAM = CARING_CONTACTS_SEARCH_NOT_APPLIED_PARAM;

/**
 * The parameter the workspace overlay host owns.
 *
 * It was a duplicated bare string with an equality test pinning it to `WORKSPACE_OVERLAY_PARAM`.
 * Both are now aliases of ONE declaration in `workspace-address.ts`, which the shell-wide fix
 * introduced -- so the divergence that pin guarded is no longer expressible, and the pin was
 * removed rather than left as an assertion that cannot fail.
 */
export const PATIENTS_DIRECTORY_OVERLAY_PARAM = CARING_CONTACTS_OVERLAY_PARAM;

/**
 * Obfuscated session filter token parameter (#HDCF2B).
 *
 * Carries non-identifying tokens representing a session-scoped search without exposing
 * patient names or PHI in the query string or proxy access logs.
 */
export const PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM = "filterToken";

/**
 * Every parameter this route understands. ANY other name on the address is dropped.
 *
 * Deliberately an allowlist rather than a `q` denylist. A bookmark can carry `?name=`, `?search=`
 * or `?patient=` just as easily as `?q=`, and a check that names only the parameter this repo
 * happened to ship would under-report every one of them.
 */
export const PATIENTS_DIRECTORY_RECOGNISED_PARAMS: readonly string[] = Object.freeze([
  CARING_CONTACTS_STATE_PARAM,
  PATIENTS_DIRECTORY_SEARCH_NOT_APPLIED_PARAM,
  PATIENTS_DIRECTORY_OVERLAY_PARAM,
  PATIENTS_DIRECTORY_FILTER_TOKEN_PARAM,
]);

// `PatientsDirectoryAddress` and `readPatientsDirectoryAddress` live in `patients-directory-address.ts`.
// That function resolves an obfuscated `sft_` filter token, which needs the server-only token store in
// `caseload-search-token.ts` (`node:crypto`) -- and this file must stay importable from
// `patients-directory-client.tsx`, a `"use client"` component. See the module note above.
