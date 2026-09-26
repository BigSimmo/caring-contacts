/**
 * Every production Caring Contacts destination, in one place.
 *
 * The shapes mirror the approved mockup identities in
 * `src/components/caring-contacts/mockups/types.ts` with the `/mockups` prefix
 * removed, and deliberately avoid every shape in
 * `SUPERSEDED_CARING_CONTACT_ROUTE_PATTERNS` — those nested the whole workspace
 * under an episode id and were rejected during design.
 *
 * Only `today` ships a page in Phase 2A. The rest are declared now so the
 * workspace navigation has one source for its hrefs and Plan 2B never has to
 * re-derive a path from a string literal scattered across components.
 *
 * This module is plain string data with no React and no client code, so the
 * tools catalogue can name the workspace's front door without pulling any of
 * the workspace itself into the PsychSift dashboard's bundle.
 *
 * It gained ONE import to stay that way rather than in spite of it.
 * `CARING_CONTACTS_PLAN_QUERY_PARAM` and `CARING_CONTACTS_REFERRAL_QUERY_PARAM`
 * are now aliases of the declarations in
 * `src/lib/caring-contacts/workspace-address.ts`, which is the allowlist the
 * workspace's overlay writer builds every history entry from. That module is
 * itself plain string data in the sealed domain -- no React, no client code, no
 * component import -- so the sentence above still holds of everything this file
 * pulls in. Single-sourcing the names is what stops this file and that allowlist
 * disagreeing about what a parameter is called, which would silently strip a
 * deep link out of its own address.
 */

import { CARING_CONTACTS_PLAN_PARAM, CARING_CONTACTS_REFERRAL_PARAM } from "@/lib/caring-contacts/workspace-address";

export const CARING_CONTACTS_BASE = "/caring-contacts" as const;

export const CARING_CONTACTS_ROUTES = {
  today: CARING_CONTACTS_BASE,
  patients: `${CARING_CONTACTS_BASE}/patients`,
  newPlan: `${CARING_CONTACTS_BASE}/plans/new`,
  schedule: `${CARING_CONTACTS_BASE}/schedule`,
  templates: `${CARING_CONTACTS_BASE}/templates`,
  team: `${CARING_CONTACTS_BASE}/team`,
  guidance: `${CARING_CONTACTS_BASE}/guidance`,
  reports: `${CARING_CONTACTS_BASE}/reports`,
  serviceStop: `${CARING_CONTACTS_BASE}/service-stop`,
  accessTrail: `${CARING_CONTACTS_BASE}/access-trail`,
  workload: `${CARING_CONTACTS_BASE}/workload`,
  reconciliation: `${CARING_CONTACTS_BASE}/reconciliation`,
  notifications: `${CARING_CONTACTS_BASE}/notifications`,
  training: `${CARING_CONTACTS_BASE}/training`,
  coverage: `${CARING_CONTACTS_BASE}/coverage`,
  intake: `${CARING_CONTACTS_BASE}/intake`,
} as const;

export type CaringContactsRouteKey = keyof typeof CARING_CONTACTS_ROUTES;
export type CaringContactsRoute = (typeof CARING_CONTACTS_ROUTES)[CaringContactsRouteKey];

export function patientRoute(patientId: string): string {
  return `${CARING_CONTACTS_ROUTES.patients}/${encodeURIComponent(patientId)}`;
}

/**
 * The query parameter the patient overview accepts to name WHICH of a patient's plans to open.
 *
 * Declared here rather than in the page, because the builder below and the page's own parser must
 * agree on the name and a second copy of the string is how they would stop agreeing. Ruling 97:
 * one patient can honestly hold two episodes, the overview never picks between them, and this is
 * how the clinician's choice travels — in the URL, so the chooser needs no client state at all.
 */
export const CARING_CONTACTS_PLAN_QUERY_PARAM = CARING_CONTACTS_PLAN_PARAM;

/** One patient's overview, scoped to one named plan. The page still validates that the plan is
 * this patient's and this team's before it reads anything with it. */
export function patientPlanRoute(patientId: string, planId: string): string {
  const params = new URLSearchParams({ [CARING_CONTACTS_PLAN_QUERY_PARAM]: planId });
  return `${patientRoute(patientId)}?${params.toString()}`;
}

/**
 * The query parameter the activation wizard accepts to name WHICH accepted referral a plan is
 * being started for.
 *
 * Declared here beside `CARING_CONTACTS_PLAN_QUERY_PARAM` and for the same reason: the builder
 * below and the page's own parser must agree on the name, and a second copy of the string is how
 * they would stop agreeing.
 *
 * Ruling [111]: a referral id in a query string is acceptable and a patient's name or mobile
 * number never is — `src/app/api/caring-contacts/plans/route.ts` records why in the code, and the
 * sentence is worth reading before adding anything else to this file: "a query string is logged by
 * every proxy between here and the browser". Nothing about a patient may travel here, including as
 * a draft key.
 */
export const CARING_CONTACTS_REFERRAL_QUERY_PARAM = CARING_CONTACTS_REFERRAL_PARAM;

/**
 * The activation wizard, started for one accepted referral.
 *
 * The page still validates that the referral is one this actor's team may see, and that it has
 * been accepted, before it starts anything with it.
 */
export function newPlanRoute(referralId: string): string {
  const params = new URLSearchParams({ [CARING_CONTACTS_REFERRAL_QUERY_PARAM]: referralId });
  return `${CARING_CONTACTS_ROUTES.newPlan}?${params.toString()}`;
}

/**
 * The query parameter the Schedule screen accepts to name WHICH AWST calendar day is open.
 *
 * Declared here beside the other two query parameters and for the same reason: the builder below
 * and the screen's own parser must agree on the name, and a second copy of the string is how they
 * would stop agreeing.
 *
 * A calendar day is identifier-shaped by construction and carries nothing about a patient, which is
 * what Ruling [111] asks of anything travelling here -- a query string is logged by every proxy
 * between here and the browser, and "2026-08-31" tells such a log nothing it did not already have
 * from the path.
 */
export const CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM = "day" as const;

/**
 * The Schedule screen, opened on one AWST calendar day.
 *
 * The day is always written into the href rather than left off for "today", so a link a clinician
 * follows, keeps or reads back later means the same day it meant when it was rendered. The bare
 * `CARING_CONTACTS_ROUTES.schedule` is the workspace navigation's entry point and resolves to today.
 */
export function scheduleDayRoute(calendarDay: string): string {
  const params = new URLSearchParams({ [CARING_CONTACTS_SCHEDULE_DAY_QUERY_PARAM]: calendarDay });
  return `${CARING_CONTACTS_ROUTES.schedule}?${params.toString()}`;
}

export function planRoute(planId: string): string {
  return `${CARING_CONTACTS_BASE}/plans/${encodeURIComponent(planId)}`;
}

export function contactRoute(contactId: string): string {
  return `${CARING_CONTACTS_BASE}/contacts/${encodeURIComponent(contactId)}`;
}

export function pathwayRoute(pathwayId: string): string {
  return `${CARING_CONTACTS_ROUTES.templates}/${encodeURIComponent(pathwayId)}`;
}

export function episodeTimelineRoute(planId: string): string {
  return `${planRoute(planId)}/timeline`;
}

export function intakeRoute(): string {
  return CARING_CONTACTS_ROUTES.intake;
}
