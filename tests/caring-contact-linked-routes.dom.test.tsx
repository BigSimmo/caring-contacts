import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CaringContactPrototypeProvider,
  CaringContactRouteSurface,
} from "@/components/caring-contacts/mockups/routable-suite";
import { CARING_CONTACT_MOCKUP_ROUTES } from "@/components/caring-contacts/mockups/routes";
import { completionOverlayDefinitions } from "@/components/caring-contacts/mockups/overlay-specimens";

function renderRoute(pathname: string, query = "") {
  const navigate = vi.fn();
  render(
    <CaringContactPrototypeProvider>
      <CaringContactRouteSurface pathname={pathname} query={query} navigate={navigate} />
    </CaringContactPrototypeProvider>,
  );
  return navigate;
}

describe("Caring Contact routable mockup", () => {
  it("renders real links for every primary and supporting destination", async () => {
    const user = userEvent.setup();
    renderRoute(CARING_CONTACT_MOCKUP_ROUTES.today);

    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    const desktop = screen.getByRole("navigation", { name: "Desktop workspace" });
    expect(within(desktop).getByRole("link", { name: "Today" })).toHaveAttribute(
      "href",
      CARING_CONTACT_MOCKUP_ROUTES.today,
    );
    expect(within(desktop).getByRole("link", { name: "Patients" })).toHaveAttribute(
      "href",
      CARING_CONTACT_MOCKUP_ROUTES.patients,
    );
    expect(within(desktop).getByRole("link", { name: "Schedule" })).toHaveAttribute(
      "href",
      CARING_CONTACT_MOCKUP_ROUTES.schedule,
    );

    await user.click(within(desktop).getByRole("button", { name: "More" }));
    const more = screen.getByRole("dialog", { name: "More" });
    expect(within(more).getByRole("link", { name: /^Templates/ })).toHaveAttribute(
      "href",
      CARING_CONTACT_MOCKUP_ROUTES.templates,
    );
    expect(within(more).getByRole("link", { name: /^System states/ })).toHaveAttribute(
      "href",
      CARING_CONTACT_MOCKUP_ROUTES.systemStates,
    );
  });

  it.each([
    [CARING_CONTACT_MOCKUP_ROUTES.patients, "Patients"],
    [CARING_CONTACT_MOCKUP_ROUTES.patient, "Patient overview"],
    [CARING_CONTACT_MOCKUP_ROUTES.plan, "Plan and contact detail"],
    [CARING_CONTACT_MOCKUP_ROUTES.schedule, "Schedule"],
    [CARING_CONTACT_MOCKUP_ROUTES.templates, "Governed templates"],
    [CARING_CONTACT_MOCKUP_ROUTES.team, "Team"],
    [CARING_CONTACT_MOCKUP_ROUTES.guidance, "Guidance"],
    [CARING_CONTACT_MOCKUP_ROUTES.reports, "Reports"],
    [CARING_CONTACT_MOCKUP_ROUTES.systemStates, "Component and system states"],
  ])("maps %s to the %s surface", (pathname, heading) => {
    renderRoute(pathname);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
  });

  it("filters the active-team patient directory without widening its scope", async () => {
    const user = userEvent.setup();
    renderRoute(CARING_CONTACT_MOCKUP_ROUTES.patients);
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by patient state" }), "Active plan");
    expect(screen.getByRole("heading", { level: 3, name: "Rowan Sample" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 3, name: "Mira Example" })).not.toBeInTheDocument();
  });

  it("moves the activation workflow by URL and keeps the exact message visible", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage=agreement");

    expect(screen.getByRole("heading", { level: 1, name: "Patient and agreement" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue to pathway selection" }));
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/plans/new?stage=pathway");
  });

  it("normalises invalid workflow stages to the earliest valid step", () => {
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage=unknown");
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/plans/new?stage=agreement");
    expect(screen.getByRole("heading", { level: 1, name: "Patient and agreement" })).toBeInTheDocument();
  });

  it("persists the selected Schedule day in the URL", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.schedule, "date=2026-08-15");
    await user.click(screen.getByRole("button", { name: "Sun 16 Aug, 3 scheduled contacts" }));
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/schedule?date=2026-08-16");
  });

  it("reconstructs guarded scenarios from the URL without browser persistence", () => {
    renderRoute(CARING_CONTACT_MOCKUP_ROUTES.systemStates, "scenario=offline");
    expect(screen.getByRole("status", { name: "Offline status" })).toBeInTheDocument();
    expect(screen.getByText(/No patient information is stored on this device/i)).toBeInTheDocument();
  });

  it("exposes deterministic recovery scenarios through privacy-safe URLs", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.systemStates);
    await user.click(screen.getByRole("button", { name: "Open version conflict scenario" }));
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/system-states?scenario=version-conflict");
  });

  it("keeps a governed mutation unavailable when the reconstructed role loses permission", () => {
    renderRoute(CARING_CONTACT_MOCKUP_ROUTES.plan, "overlay=pause&scenario=permission-unavailable");
    const dialog = screen.getByRole("dialog", { name: "Pause caring-contact plan" });
    const action = within(dialog).getByRole("button", { name: "Pause future contacts" });
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByText(/Permission is unavailable/i)).toBeInTheDocument();
  });

  it("rechecks connectivity after a decision surface has already opened", () => {
    renderRoute(CARING_CONTACT_MOCKUP_ROUTES.plan, "overlay=pause");
    const dialog = screen.getByRole("dialog", { name: "Pause caring-contact plan" });
    const action = within(dialog).getByRole("button", { name: "Pause future contacts" });
    expect(action).not.toHaveAttribute("aria-disabled");
    act(() => window.dispatchEvent(new Event("offline")));
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(within(dialog).getByText(/offline/i)).toBeInTheDocument();
  });

  it("clears recovery scenarios from the URL after successful recovery", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.systemStates, "scenario=offline&overlay=offline-banner");
    await user.click(screen.getByRole("button", { name: "Try reconnecting" }));
    expect(navigate).toHaveBeenCalledWith(CARING_CONTACT_MOCKUP_ROUTES.systemStates);
  });

  it("opens a governed decision from the URL and closes through route history", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage=review&overlay=final-activation");

    const dialog = screen.getByRole("dialog", { name: "Final activation assurance" });
    expect(within(dialog).getByTestId("overlay-specific-content")).toHaveAttribute(
      "data-overlay-id",
      "final-activation",
    );
    await user.keyboard("{Escape}");
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/plans/new?stage=review");
  });

  it("opens workflow and plan decisions through contextual URLs", async () => {
    const user = userEvent.setup();
    const reviewNavigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage=review");
    await user.click(screen.getByRole("button", { name: "Activate 10-contact plan" }));
    expect(reviewNavigate).toHaveBeenCalledWith(
      "/mockups/caring-contacts/plans/new?stage=review&overlay=final-activation",
    );

    const planNavigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.plan);
    await user.click(screen.getAllByRole("button", { name: "Pause plan" }).at(-1)!);
    expect(planNavigate).toHaveBeenCalledWith("/mockups/caring-contacts/plans/SYN-PLAN-001?overlay=pause");

    await user.click(screen.getAllByRole("button", { name: "Reassign coordinator" }).at(-1)!);
    expect(planNavigate).toHaveBeenCalledWith("/mockups/caring-contacts/plans/SYN-PLAN-001?overlay=reassignment");
  });

  it("requires a visible fresh-auth checkpoint before protected decisions commit", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.plan, "overlay=withdrawal");
    const dialog = screen.getByRole("dialog", { name: "Record patient-requested withdrawal" });

    await user.click(within(dialog).getByRole("button", { name: "Continue to fresh authentication" }));
    expect(within(dialog).getByText("Fresh authentication checkpoint")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Authenticate and record synthetic withdrawal" }));
    expect(navigate).toHaveBeenCalledWith(CARING_CONTACT_MOCKUP_ROUTES.plan);
  });

  it("opens message governance from personalisation context", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.newPlan, "stage=personalisation");
    await user.click(screen.getByRole("button", { name: "Open message preview" }));
    expect(navigate).toHaveBeenCalledWith(
      "/mockups/caring-contacts/plans/new?stage=personalisation&overlay=message-preview",
    );
  });

  it("makes all 24 governed overlays addressable from the system-state lab", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.systemStates);

    for (const definition of completionOverlayDefinitions) {
      await user.click(screen.getByRole("button", { name: `Open ${definition.label}` }));
      expect(navigate).toHaveBeenLastCalledWith(`/mockups/caring-contacts/system-states?overlay=${definition.id}`);
    }
  });

  it("keeps supporting navigation and team context route-aware", async () => {
    const user = userEvent.setup();
    const navigate = renderRoute(CARING_CONTACT_MOCKUP_ROUTES.systemStates);
    expect(
      within(screen.getByRole("navigation", { name: "Desktop workspace" })).getByRole("button", {
        name: "More",
      }),
    ).toHaveAttribute("aria-current", "page");

    await user.click(screen.getByRole("button", { name: /Example Aftercare Team/ }));
    expect(navigate).toHaveBeenCalledWith("/mockups/caring-contacts/system-states?overlay=team-switcher");
  });
});
