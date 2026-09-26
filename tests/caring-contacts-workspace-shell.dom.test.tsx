import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CaringContactsShell } from "@/components/caring-contacts/workspace/shell";
import { FICTIONAL_DATA_MARKER } from "@/components/caring-contacts/workspace/synthetic-marker";
import {
  CARING_CONTACTS_PLAN_QUERY_PARAM,
  CARING_CONTACTS_REFERRAL_QUERY_PARAM,
  CARING_CONTACTS_ROUTES,
} from "@/lib/caring-contacts-routes";
import * as routeModule from "@/lib/caring-contacts-routes";
import {
  CARING_CONTACTS_WORKSPACE_RECOGNISED_PARAMS,
  canonicalCaringContactsQuery,
} from "@/lib/caring-contacts/workspace-address";
import {
  WORKSPACE_OVERLAY_PARAM,
  closeWorkspaceOverlay,
  openWorkspaceOverlay,
} from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { teamId } from "@/lib/caring-contacts/ids";
import { runningService } from "@/lib/caring-contacts/service-state";

/**
 * Ruling 52: the workspace navigation renders its whole destination set now, and
 * every destination that has no page yet is an *unavailable control with a stated
 * reason* — never a link to a route that would 404.
 *
 * The kind of each destination is derived from the DOM itself rather than read
 * off a marker attribute the shell controls, so the shell cannot satisfy this
 * test by relabelling a dead link.
 */
type DestinationKind = "link" | "in-page" | "unavailable" | "live-action" | "unknown";

function destinationKind(element: Element): DestinationKind {
  if (element.tagName === "A") {
    const href = element.getAttribute("href") ?? "";
    if (href.startsWith("#")) return "in-page";
    return href ? "link" : "unknown";
  }
  if (element.tagName === "BUTTON") {
    return element.getAttribute("aria-disabled") === "true" ? "unavailable" : "live-action";
  }
  return "unknown";
}

/** Every destination in one navigation, in DOM order, as { label, kind }. */
function destinationsOf(navigation: HTMLElement) {
  return [...navigation.querySelectorAll("a, button")].map((element) => ({
    label: element.textContent,
    kind: destinationKind(element),
  }));
}

/**
 * The Tailwind min-width variants this shell uses, and the width each one starts at.
 *
 * A closed map rather than a pattern, and `rendersAt` THROWS on a variant that is not in it. The
 * whole point of this helper is that it must not guess: a silent "assume visible" would turn every
 * reachability assertion below into an assertion about nothing, which is the exact failure mode the
 * orphan-route gate already has and that these tests exist to close.
 */
const VARIANT_MIN_WIDTH: Readonly<Record<string, number>> = {
  "": 0,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
  "min-[1440px]": 1440,
};

const DISPLAY_UTILITIES = new Set([
  "hidden",
  "block",
  "flex",
  "grid",
  "inline-flex",
  "inline-block",
  "contents",
  "flow-root",
  "table",
  "list-item",
]);

/**
 * Whether `element` is displayed at `width`, from its own classes and every ancestor's.
 *
 * WHY THIS EXISTS. `tests/route-reachability.test.ts` reads `shell.tsx` as TEXT and regex-matches
 * `href…CARING_CONTACTS_ROUTES.<key>`. It has no notion of which array the match sits in, whether
 * that array is filtered, or what CSS governs the element rendering it -- so it proves a route is
 * REFERENCED IN SOURCE and passes whether or not any viewport can reach it. Templates was
 * unreachable below 768px for the whole of Phase 2B Task 15 with that gate green.
 *
 * This walks the REAL rendered ancestor chain and resolves the display utility that wins at the
 * given width, so an element moved into a `hidden md:flex` container fails here.
 *
 * WHAT IT DOES NOT MODEL, stated because "renders at 375" reads stronger than what is checked. It
 * resolves DISPLAY UTILITIES and nothing else. A link is reported as rendering when it is in fact
 * unreachable if it is hidden by `sr-only`, `invisible`, `opacity-0`, `visibility`, a clipped or
 * zero-size ancestor, an off-screen transform, a stacking-order overlay, or the plain `hidden`
 * attribute -- none of which this looks at. It fails closed on an unrecognised display VARIANT,
 * which is a narrower guarantee than failing closed on an unrecognised way of hiding something.
 *
 * The only thing covering that gap today is the 390px block in
 * `tests/ui-caring-contacts-workspace.spec.ts`, which asks a real browser whether the link is
 * visible and clicks it. Treat this helper as the fast half of a pair, never as the whole proof.
 */
function rendersAt(element: Element, width: number): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    let winner: string | null = null;
    let winningWidth = -1;
    for (const token of node.classList) {
      const cut = token.lastIndexOf(":");
      const variant = cut === -1 ? "" : token.slice(0, cut);
      const utility = cut === -1 ? token : token.slice(cut + 1);
      if (!DISPLAY_UTILITIES.has(utility)) continue;
      const from = VARIANT_MIN_WIDTH[variant];
      if (from === undefined) {
        throw new Error(
          `rendersAt: unrecognised display variant "${token}" — teach this helper rather than let it guess`,
        );
      }
      // Tailwind emits min-width variants in ascending order, so the widest breakpoint that has
      // been reached is the one in force.
      if (from <= width && from >= winningWidth) {
        winningWidth = from;
        winner = utility;
      }
    }
    if (winner === "hidden") return false;
  }
  return true;
}

/** The full unavailable-control convention from docs/wiring-conventions.md. */
function expectStatesItsReason(control: Element) {
  expect(control.tagName, `${control.textContent} should be a button, not an anchor`).toBe("BUTTON");
  expect(control).toHaveAttribute("aria-disabled", "true");
  expect(control).toHaveAttribute("type", "button");
  expect(control).toHaveAttribute("title", expect.stringContaining("coming soon"));
  // Native `disabled` would remove the tab stop, so the stated reason could never
  // be reached by keyboard. The two attributes are never used together.
  expect(control).not.toHaveAttribute("disabled");
  const describedBy = control.getAttribute("aria-describedby");
  expect(describedBy, `${control.textContent} states no reason`).toBeTruthy();
  expect(document.getElementById(describedBy!)?.textContent ?? "").not.toBe("");
}

function renderShell() {
  // `serviceState` became required in Task 16 (Ruling 56), so this call site gains
  // an argument. A running service renders no banner, so every expectation below --
  // including the exact count of unavailable controls -- is unchanged.
  return render(
    <CaringContactsShell title="Today" serviceState={runningService(teamId("shell-test-team"))}>
      content
    </CaringContactsShell>,
  );
}

describe("caring-contacts workspace shell", () => {
  it("renders exactly one h1 and marks the workspace synthetic", () => {
    renderShell();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toBeInTheDocument();
  });

  it("says in so many words that the data is invented", () => {
    renderShell();
    // Presence by test id is not enough. Without this, the wording could be
    // changed to anything at all — including something that no longer says the
    // data is invented — and every gate on this branch would still pass. This is
    // the safeguard that makes listing a workspace of invented patients in the
    // live tools catalogue defensible, so its text is pinned, exactly as the
    // prototype's copy is pinned by caring-contact-product-redesign.dom.test.tsx.
    expect(FICTIONAL_DATA_MARKER).toBe("Synthetic prototype — fictional data only");
    expect(screen.getByTestId("caring-contacts-synthetic-marker")).toHaveTextContent(
      "Synthetic prototype — fictional data only",
    );
  });

  it("keeps the frozen rail destination set, in order, with only the built screens navigable", () => {
    renderShell();
    expect(destinationsOf(screen.getByRole("navigation", { name: "Workspace" }))).toEqual([
      { label: "Today", kind: "link" },
      // Patients became a link in Phase 2B Task 5, and Schedule in Task 13, each in the same
      // change as its own page (Ruling 89).
      { label: "Patients", kind: "link" },
      { label: "Schedule", kind: "link" },
      // Templates became a link in Phase 2B Task 15, in the same change as its page (Ruling 89).
      { label: "Templates", kind: "link" },
      // The built More destinations, repeated in the desktop rail (2026-09-26) in the More panel's
      // own order, so a wide screen reaches them without scrolling to the panel.
      { label: "Team", kind: "link" },
      { label: "Guidance", kind: "link" },
      { label: "Reports", kind: "link" },
      { label: "Referral intake", kind: "link" },
      // Service stop and Access trail joined in the same change as their pages (owner request
      // 2026-09-26: "The emergency safety stop has no button"), in the More panel's own order.
      { label: "Service stop", kind: "link" },
      { label: "Access trail", kind: "link" },
    ]);
  });

  it("keeps the frozen phone destination set, in order, with More reaching the in-page panel", () => {
    renderShell();
    expect(destinationsOf(screen.getByRole("navigation", { name: "Phone workspace" }))).toEqual([
      { label: "Today", kind: "link" },
      { label: "Patients", kind: "link" },
      { label: "Schedule", kind: "link" },
      { label: "More", kind: "in-page" },
    ]);
  });

  it("offers a skip link to the main content as the first focusable element", () => {
    const { container } = renderShell();
    const first = container.querySelector("a[href], button, input, select, textarea, [tabindex]:not([tabindex='-1'])");
    expect(first).toHaveTextContent("Skip to main content");
    expect(first).toHaveAttribute("href", "#main-content");
    expect(container.querySelector("main#main-content")).not.toBeNull();
  });

  it("navigates internally with Link, never a raw anchor to an internal route", () => {
    const { container } = renderShell();
    for (const anchor of container.querySelectorAll("a[href^='/']")) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
    }
  });

  it("links only to routes that exist, so no destination can reach a 404", () => {
    const { container } = renderShell();
    const internalHrefs = [...container.querySelectorAll("a[href^='/']")].map((anchor) => anchor.getAttribute("href"));
    expect(internalHrefs.length).toBeGreaterThan(0);
    // These are the Caring Contacts routes with a page. Every other declared destination is an
    // unavailable control until Plan 2B builds its page. Named by the set below rather than
    // restated here: the list moved twice during the merge and a prose copy of it decays.
    expect(new Set(internalHrefs)).toEqual(
      new Set([
        CARING_CONTACTS_ROUTES.today,
        CARING_CONTACTS_ROUTES.patients,
        CARING_CONTACTS_ROUTES.schedule,
        CARING_CONTACTS_ROUTES.newPlan,
        CARING_CONTACTS_ROUTES.templates,
        CARING_CONTACTS_ROUTES.guidance,
        CARING_CONTACTS_ROUTES.reports,
        CARING_CONTACTS_ROUTES.team,
        CARING_CONTACTS_ROUTES.intake,
        CARING_CONTACTS_ROUTES.serviceStop,
        CARING_CONTACTS_ROUTES.accessTrail,
      ]),
    );
  });

  it("keeps the More panel's destination set, in order, with only the built screens navigable", () => {
    renderShell();
    // Templates leads the panel and is a LINK: it is a primary destination the phone bar has no
    // room for, so the panel carries it below 768px where the rail does not exist. Guidance and
    // Reports became links in Phase 2B Task 19, in the same change as their pages (Ruling 89), and
    // Team in Task 18 for the same reason.
    expect(destinationsOf(screen.getByRole("region", { name: "More destinations" }))).toEqual([
      { label: "Templates", kind: "link" },
      { label: "Team", kind: "link" },
      { label: "Guidance", kind: "link" },
      { label: "Reports", kind: "link" },
      // Referral intake has had a page since the intake fallback was built; it was reachable only
      // from a quick link on Today until it joined this panel.
      { label: "Referral intake", kind: "link" },
      // Links since the service stop screen and the access trail screen were built (2026-09-26).
      { label: "Service stop", kind: "link" },
      { label: "Access trail", kind: "link" },
      ...["Workload", "Reconciliation", "Notifications", "Training", "Coverage"].map((label) => ({
        label,
        kind: "unavailable",
      })),
    ]);
  });

  it("makes the workspace's primary control a real link, now that the screen behind it exists", () => {
    // It was an unavailable control until Phase 2B Task 7 built `/caring-contacts/plans/new`.
    // Ruling 89 requires the two to move together in BOTH directions: a control lit up early points
    // at a page that says nothing useful, and a control left unavailable late claims a screen is
    // not built when it is.
    const { container } = renderShell();
    const primary = screen.getByTestId("caring-contacts-primary-control").closest("a");
    expect(primary, "the primary control is not a link").not.toBeNull();
    expect(primary!.textContent).toBe("New plan");
    expect(destinationKind(primary!)).toBe("link");
    expect(primary).toHaveAttribute("href", CARING_CONTACTS_ROUTES.newPlan);
    expect(primary).toHaveAttribute("data-internal-link", "true");
    // ALL of them in the More panel: the rail and the phone bar now carry none at all. Each branch
    // counted only its own screens -- one said 11 with Templates still unbuilt on the rail, the
    // other 10 with Schedule unbuilt on both the rail and the phone bar. Merged, Task 13 lit
    // Schedule, Task 15 lit Templates and Task 18 lit Team, so all three leave the count entirely.
    // What remains is exactly the destinations with no page, named rather than counted so the
    // expectation states which set it is about: Workload, Reconciliation, Notifications, Training
    // and Coverage (Service stop and Access trail left it on 2026-09-26, with their pages). Derived
    // from the two destination tables in `shell.tsx`, not from what this suite happened to print.
    const unbuilt = ["Workload", "Reconciliation", "Notifications", "Training", "Coverage"];
    expect(
      [...container.querySelectorAll("button")]
        .filter((c) => destinationKind(c) === "unavailable")
        .map((c) => (c.textContent ?? "").trim()),
    ).toEqual(unbuilt);
  });

  it("states a reason on every destination that is not built yet", () => {
    const { container } = renderShell();
    const unavailable = [...container.querySelectorAll("button")].filter(
      (control) => destinationKind(control) === "unavailable",
    );
    // The More panel and nothing else: the rail and the phone bar carry no unbuilt destination.
    // The floor stays at 5: it was written as a floor rather than a count, the exact count is
    // asserted above, and lowering a floor a change did not breach is loosening for its own sake.
    expect(unavailable.length).toBeGreaterThanOrEqual(5);
    for (const control of unavailable) expectStatesItsReason(control);
  });

  it("resolves what the rail and the phone dock are displayed at, which is what makes the next test real", () => {
    // THE POSITIVE CONTROL FOR `rendersAt`. Every reachability assertion below is of the form
    // "some link renders at this width"; if the helper answered `true` for everything, they would
    // all pass over a workspace no phone could navigate. The rail and the dock are the two
    // elements whose visibility is opposite by construction, so they pin both directions.
    renderShell();
    const rail = screen.getByTestId("caring-contacts-rail");
    const dock = screen.getByTestId("caring-contacts-phone-dock");

    expect(rendersAt(rail, 375), "the rail is not supposed to exist on a phone").toBe(false);
    expect(rendersAt(rail, 900), "the rail is supposed to exist at rail width").toBe(true);
    expect(rendersAt(dock, 375), "the phone dock is supposed to exist on a phone").toBe(true);
    expect(rendersAt(dock, 900), "the phone dock is not supposed to exist at rail width").toBe(false);
  });

  it("gives every built route a link that a phone can reach, and one that a rail-width viewport can", () => {
    // THE DEFECT THIS CLOSES. Templates shipped a production page, an `href` in the rail, and a
    // green orphan-route gate -- while being unreachable below 768px, because the rail is
    // `hidden … md:flex` and the phone bar filtered Templates out by name. The gate reads
    // `shell.tsx` as text and cannot see either fact. This walks the rendered DOM instead.
    const { container } = renderShell();
    const built = [
      CARING_CONTACTS_ROUTES.today,
      CARING_CONTACTS_ROUTES.patients,
      CARING_CONTACTS_ROUTES.newPlan,
      CARING_CONTACTS_ROUTES.templates,
      CARING_CONTACTS_ROUTES.guidance,
      CARING_CONTACTS_ROUTES.reports,
      CARING_CONTACTS_ROUTES.team,
      CARING_CONTACTS_ROUTES.serviceStop,
      CARING_CONTACTS_ROUTES.accessTrail,
    ];

    for (const href of built) {
      const links = [...container.querySelectorAll(`a[href="${href}"]`)];
      expect(links.length, `${href} is not linked from the shell at all`).toBeGreaterThan(0);
      expect(
        links.some((link) => rendersAt(link, 375)),
        `${href} has no link a phone can reach — it is an orphan below 768px`,
      ).toBe(true);
      expect(
        links.some((link) => rendersAt(link, 900)),
        `${href} has no link a rail-width viewport can reach`,
      ).toBe(true);
    }
  });

  it("exposes the frozen width state so the media-class layout is observable", () => {
    const { container } = renderShell();
    expect(
      [...container.querySelectorAll("[data-workspace-width-state]")].map((node) =>
        node.getAttribute("data-workspace-width-state"),
      ),
    ).toEqual(["compact", "rail", "split", "wide"]);
  });
});

/*
 * The shell-wide address contract (Ruling [111]).
 *
 * These live HERE rather than in `tests/caring-contacts-overlay-host.dom.test.tsx`, which is the
 * overlay module's natural home, for one reason worth stating: `npm run test:cc-guards` runs this
 * file and does not run that one. A privacy assertion in a file the programme's gate never executes
 * is a silenced gate, which is the failure this whole round is about.
 *
 * WHAT THEY PIN. `overlayUrl()` used to build every history entry by copying the whole existing
 * query string. The shell mounts the overlay module on EVERY workspace route, so a bookmarked
 * `?q=<name>` opened anywhere in the workspace was written into a fresh history entry on every
 * overlay open. The Patients page fixed its own route by rewriting the address on the server; the
 * mechanism was never route-specific, and this is the same defect on the other three.
 */

/** The forms a name could survive in an address. */
function urlFormsOf(text: string): string[] {
  return [
    text,
    text.toLowerCase(),
    encodeURIComponent(text),
    encodeURIComponent(text).toLowerCase(),
    text.replace(/ /g, "+"),
    ...text.split(" "),
    ...text.toLowerCase().split(" "),
  ];
}

/**
 * Every workspace route the finding names, with the one parameter that route legitimately owns.
 *
 * Each is exercised on its own rather than one standing in for the others: the whole finding is
 * that the defect is generic, and a single route would prove only what the previous round proved.
 */
const ROUTES_CARRYING_A_BOOKMARK = [
  { name: "the workspace home", path: CARING_CONTACTS_ROUTES.today, keep: null },
  {
    name: "the activation wizard",
    path: CARING_CONTACTS_ROUTES.newPlan,
    keep: { param: CARING_CONTACTS_REFERRAL_QUERY_PARAM, value: "referral-1" },
  },
  {
    name: "the patient overview",
    path: `${CARING_CONTACTS_ROUTES.patients}/patient-1`,
    keep: { param: CARING_CONTACTS_PLAN_QUERY_PARAM, value: "plan-1" },
  },
] as const;

describe("the workspace address - a bookmarked name is never copied into an overlay history entry", () => {
  const NAME = "Jordan Nguyen";
  const OVERLAY = "consent-and-withdrawal";

  beforeEach(() => {
    window.history.replaceState(null, "", "/");
  });

  for (const route of ROUTES_CARRYING_A_BOOKMARK) {
    it(`drops it on ${route.name}, and keeps what that route owns`, () => {
      const carried = new URLSearchParams({ q: NAME });
      if (route.keep) carried.set(route.keep.param, route.keep.value);
      window.history.replaceState(null, "", `${route.path}?${carried.toString()}`);

      // POSITIVE CONTROL. The name really is in the address before the overlay opens; without
      // this, the absence below would be an absence over an address that never carried a name.
      expect(window.location.search).toContain("Jordan");
      expect(window.location.search).toContain("Nguyen");

      act(() => openWorkspaceOverlay(OVERLAY));

      // The entry really was written -- so what follows is a rewritten entry, not a no-op.
      expect(window.location.search).toContain(`${WORKSPACE_OVERLAY_PARAM}=${OVERLAY}`);
      expect(window.location.pathname).toBe(route.path);
      // ...and this route's own parameter survived it, so the rewrite narrowed rather than erased.
      if (route.keep) {
        expect(new URLSearchParams(window.location.search).get(route.keep.param)).toBe(route.keep.value);
      }

      for (const form of urlFormsOf(NAME)) {
        expect(window.location.search, `the pushed entry carries "${form}"`).not.toContain(form);
      }
    });
  }

  it("drops it when an overlay is CLOSED from an entry this module did not push", () => {
    // The `replaceState` half of the same function. A deep link has no entry of ours to unwind, so
    // closing replaces the current one -- and that write went through the same copying builder.
    window.history.replaceState(
      null,
      "",
      `${CARING_CONTACTS_ROUTES.today}?${WORKSPACE_OVERLAY_PARAM}=${OVERLAY}&q=${encodeURIComponent(NAME)}`,
    );
    expect(window.location.search).toContain("Nguyen");

    act(() => closeWorkspaceOverlay());

    expect(window.location.search).not.toContain(WORKSPACE_OVERLAY_PARAM);
    for (const form of urlFormsOf(NAME)) {
      expect(window.location.search, `the replaced entry carries "${form}"`).not.toContain(form);
    }
  });

  it("is a fixed point of itself, so a rewritten address is never rewritten again", () => {
    // `overlayUrl()` runs on addresses it may already have written, and the Patients page redirects
    // to its own canonical form. A canonicaliser that is not idempotent either loops or drifts.
    const once = canonicalCaringContactsQuery(`?q=${encodeURIComponent(NAME)}&state=active`, { overlay: OVERLAY });
    const twice = canonicalCaringContactsQuery(`?${once}`);

    expect(once).not.toBe("");
    expect(twice).toBe(once);
    expect(once).toContain("state=active");
    for (const form of urlFormsOf(NAME)) expect(once).not.toContain(form);
  });

  it("recognises every query parameter the route module declares", () => {
    // The allowlist's failure direction is to DROP an unregistered parameter, which is the
    // conservative direction for privacy and a silent breakage for a feature. This is what makes a
    // parameter added later loud instead of mysterious.
    //
    // It reads the exports rather than the source text on purpose: those constants are now aliases
    // of the sealed declarations, so a regex for string literals in `caring-contacts-routes.ts`
    // would match nothing and pass vacuously.
    const declared = Object.entries(routeModule)
      .filter(([name]) => name.endsWith("_QUERY_PARAM"))
      .map(([name, value]) => [name, String(value)] as const);

    // A floor, so an empty scan cannot satisfy the loop below.
    expect(declared.length).toBeGreaterThanOrEqual(2);
    for (const [name, value] of declared) {
      expect(CARING_CONTACTS_WORKSPACE_RECOGNISED_PARAMS, `${name} ("${value}") is not recognised`).toContain(value);
    }
  });
});

describe("caring-contacts workspace shell sign-out", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("offers no sign-out outside live mode", () => {
    renderShell();
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });

  it("offers a sign-out form posting to the sign-out route in live mode", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "false");
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", "x".repeat(64));
    vi.stubEnv("CARING_CONTACTS_DATABASE_URL", "postgres://caring@127.0.0.1:54329/postgres");
    renderShell();
    const button = screen.getByRole("button", { name: "Sign out" });
    const form = button.closest("form");
    expect(form).toHaveAttribute("action", "/api/caring-contacts/auth/sign-out");
    expect(form).toHaveAttribute("method", "post");
  });
});
