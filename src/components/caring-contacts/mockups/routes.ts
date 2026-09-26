export const CARING_CONTACT_MOCKUP_BASE = "/mockups/caring-contacts" as const;

export const CARING_CONTACT_MOCKUP_ROUTES = {
  today: CARING_CONTACT_MOCKUP_BASE,
  patients: `${CARING_CONTACT_MOCKUP_BASE}/patients`,
  patient: `${CARING_CONTACT_MOCKUP_BASE}/patients/SYN-PATIENT-001`,
  newPlan: `${CARING_CONTACT_MOCKUP_BASE}/plans/new`,
  plan: `${CARING_CONTACT_MOCKUP_BASE}/plans/SYN-PLAN-001`,
  schedule: `${CARING_CONTACT_MOCKUP_BASE}/schedule`,
  contact: `${CARING_CONTACT_MOCKUP_BASE}/contacts/SYN-CONTACT-004`,
  templates: `${CARING_CONTACT_MOCKUP_BASE}/templates`,
  template: `${CARING_CONTACT_MOCKUP_BASE}/templates/SYN-PATHWAY-001`,
  team: `${CARING_CONTACT_MOCKUP_BASE}/team`,
  guidance: `${CARING_CONTACT_MOCKUP_BASE}/guidance`,
  reports: `${CARING_CONTACT_MOCKUP_BASE}/reports`,
  systemStates: `${CARING_CONTACT_MOCKUP_BASE}/system-states`,
} as const;

export type ActivationStage = "agreement" | "pathway" | "personalisation" | "review";
export type CaringContactMockupRoute = (typeof CARING_CONTACT_MOCKUP_ROUTES)[keyof typeof CARING_CONTACT_MOCKUP_ROUTES];

function withQuery(route: string, key: string, value: string) {
  const separator = route.includes("?") ? "&" : "?";
  return `${route}${separator}${key}=${encodeURIComponent(value)}`;
}

export const caringContactMockupRoute = {
  newPlan(stage: ActivationStage) {
    return withQuery(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage", stage);
  },
  schedule(date: string) {
    return withQuery(CARING_CONTACT_MOCKUP_ROUTES.schedule, "date", date);
  },
  scenario(scenario: string, route: string = CARING_CONTACT_MOCKUP_ROUTES.systemStates) {
    return withQuery(route, "scenario", scenario);
  },
  overlay(overlay: string, route: string = CARING_CONTACT_MOCKUP_ROUTES.systemStates) {
    return withQuery(route, "overlay", overlay);
  },
} as const;

export const PRIMARY_CARING_CONTACT_DESTINATIONS = [
  { href: CARING_CONTACT_MOCKUP_ROUTES.today, label: "Today" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.patients, label: "Patients" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.schedule, label: "Schedule" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.templates, label: "Templates" },
] as const;

export const SUPPORTING_CARING_CONTACT_DESTINATIONS = [
  { href: CARING_CONTACT_MOCKUP_ROUTES.team, label: "Team" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.guidance, label: "Guidance" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.reports, label: "Reports" },
  { href: CARING_CONTACT_MOCKUP_ROUTES.systemStates, label: "System states" },
] as const;
