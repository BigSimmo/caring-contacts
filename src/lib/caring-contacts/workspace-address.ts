/**
 * What a Caring Contacts web address is allowed to contain, for the WHOLE workspace.
 *
 * This module is also the sole DECLARATION of every one of those parameter names.
 * `caring-contacts-routes.ts` and `workspace-overlays.tsx` re-export from here rather than
 * declaring their own copies, so there is no duplicated literal left to drift and no equality pin
 * needed to catch drift that can no longer happen. What CAN still go wrong is a new parameter
 * declared and never registered below, and that is what the coverage test guards.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ruling [111]: "a query string is logged by every proxy between here and the browser. Nothing
 * about a patient may travel here." The Patients caseload was fixed first -- its search moved into
 * the browser and its page rewrites any address carrying an unrecognised parameter. That fix was
 * scoped to one route, and the mechanism was never route-specific.
 *
 * `overlayUrl()` in `workspace-overlays.tsx` built each overlay history entry by COPYING every
 * parameter already on the address. The workspace shell mounts that module on every route, so a
 * bookmarked `?q=<name>` opened on `/caring-contacts`, `/caring-contacts/plans/new` or
 * `/caring-contacts/patients/[patientId]` was written into a FRESH history entry every time a
 * coordinator opened an overlay. One name in an address bar became one name per overlay open, in
 * the history of a possibly-shared ward computer.
 *
 * This module is the single allowlist those entries are now built from.
 *
 * WHY AN ALLOWLIST AND NOT A DENYLIST
 * -----------------------------------
 * A denylist has to name the parameter that leaked. A bookmark can carry `?q=`, `?name=`,
 * `?search=` or `?patient=` just as easily, and a denylist is wrong again the moment somebody
 * invents a new one. An allowlist is the only form that is still correct when a parameter nobody
 * has thought of yet arrives. The rule this module follows everywhere is therefore: NAME WHAT MAY
 * BE KEPT; never delete what may not.
 *
 * The direction of failure follows from that. An address parameter nobody added here is dropped --
 * so a NEW route parameter that is not registered stops working rather than leaking. That is the
 * conservative direction, and `tests/caring-contacts-workspace-shell.dom.test.tsx` makes it loud
 * instead of mysterious: it reads `caring-contacts-routes.ts` for every `*_QUERY_PARAM` declared
 * there and fails when one is missing from the set below.
 *
 * WHY THE NAMES ARE DECLARED HERE RATHER THAN COPIED HERE
 * ------------------------------------------------------
 * Everything under `src/lib/caring-contacts/` is sealed: it may import nothing outside itself. That
 * seals its OUTGOING edges only -- a component or a route builder may import inward freely -- so
 * the way to avoid duplicating these strings is to declare them at the sealed end and re-export
 * them outward. `WORKSPACE_OVERLAY_PARAM`, `CARING_CONTACTS_PLAN_QUERY_PARAM` and
 * `CARING_CONTACTS_REFERRAL_QUERY_PARAM` are now aliases of the constants below.
 *
 * The first draft of this module duplicated them as bare strings and proposed an equality test to
 * catch divergence. Single-sourcing is strictly better: an equality assertion between two aliases
 * of one constant cannot fail, and a check that cannot fail is worse than no check.
 */

/** Names an open overlay. Owned by `WORKSPACE_OVERLAY_PARAM` in `workspace-overlays.tsx`. */
export const CARING_CONTACTS_OVERLAY_PARAM = "overlay" as const;

/** The Patients caseload's plan-state filter. Non-identifying, and the one filter that is a URL. */
export const CARING_CONTACTS_STATE_PARAM = "state" as const;

/** Records that a saved search term was dropped on the way in. A flag, never the term. */
export const CARING_CONTACTS_SEARCH_NOT_APPLIED_PARAM = "searchNotApplied" as const;

/** Owned by `CARING_CONTACTS_PLAN_QUERY_PARAM`; scopes the patient overview to one plan. */
export const CARING_CONTACTS_PLAN_PARAM = "plan" as const;

/** Owned by `CARING_CONTACTS_REFERRAL_QUERY_PARAM`; names the referral a plan is started for. */
export const CARING_CONTACTS_REFERRAL_PARAM = "referral" as const;

/**
 * Owned by `CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM`; the calendar day the Schedule screen shows.
 *
 * Declared here as its own literal rather than imported, for the same reason every parameter above
 * is: nothing under `src/lib/caring-contacts/` may import a `@/lib` module outside itself, and the
 * owning constant lives in `caring-contacts-routes.ts`. The shell suite's "recognises every query
 * parameter the route module declares" case is what holds the two equal, and it is what caught this
 * one -- the parameter was declared on one branch while this union lived on another, so until the
 * merge no gate could see both.
 *
 * It carries a date and never anything about a patient, so Ruling [111] permits it in an address.
 */
export const CARING_CONTACTS_DAY_PARAM = "day" as const;

/**
 * Every parameter any Caring Contacts route may carry, in the order a canonical address writes
 * them. A UNION across routes, deliberately: this set is applied by the overlay writer, which runs
 * on every screen, so a per-route set would strip another route's own parameter and break it.
 *
 * A per-route set is still narrower where a route can afford one -- the Patients page recognises
 * only its own three, so a stray `?referral=` there is dropped rather than carried.
 */
export const CARING_CONTACTS_WORKSPACE_RECOGNISED_PARAMS: readonly string[] = Object.freeze([
  CARING_CONTACTS_OVERLAY_PARAM,
  CARING_CONTACTS_STATE_PARAM,
  CARING_CONTACTS_SEARCH_NOT_APPLIED_PARAM,
  CARING_CONTACTS_PLAN_PARAM,
  CARING_CONTACTS_REFERRAL_PARAM,
  CARING_CONTACTS_DAY_PARAM,
]);

/**
 * The query string a Caring Contacts address should have: recognised parameters only, in a fixed
 * order, `""` when there are none.
 *
 * `overlay` is `undefined` to leave whatever the address already had, a string to set it, and
 * `null` to remove it -- the three things opening, re-rendering and closing an overlay need.
 *
 * IDEMPOTENT BY CONSTRUCTION, which is not a nicety: `overlayUrl()` calls this on an address this
 * function may already have written, and the Patients page redirects to its own canonical form. A
 * canonicaliser whose output is not a fixed point of itself either loops or drifts, and this one
 * cannot, because it reads only names it also writes.
 */
export function canonicalCaringContactsQuery(
  search: string | URLSearchParams,
  options: { overlay?: string | null } = {},
): string {
  const incoming = typeof search === "string" ? new URLSearchParams(search) : search;

  // Built by NAMING what may be kept. `incoming` is never copied, spread or filtered into `kept`,
  // because a copy is how an unrecognised value ends up somewhere nobody meant it to be.
  const kept = new URLSearchParams();
  for (const name of CARING_CONTACTS_WORKSPACE_RECOGNISED_PARAMS) {
    if (name === CARING_CONTACTS_OVERLAY_PARAM && options.overlay !== undefined) {
      if (options.overlay !== null) kept.set(CARING_CONTACTS_OVERLAY_PARAM, options.overlay);
      continue;
    }
    const value = incoming.get(name);
    if (value !== null) kept.set(name, value);
  }
  return kept.toString();
}
