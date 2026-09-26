import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ListEmptyState } from "@/components/caring-contacts/workspace/list-empty-state";
import Link from "next/link";

describe("ListEmptyState — no-data", () => {
  it("renders the heading and the explanation, and no Why/What-changes-it pair", () => {
    const { container } = render(
      <ListEmptyState kind="no-data" heading="No patients yet" explanation="Add the first patient to get started." />,
    );
    expect(screen.getByText("No patients yet")).toBeInTheDocument();
    expect(screen.getByText("Add the first patient to get started.")).toBeInTheDocument();
    // The "filtered" wording shape must never leak onto a genuinely empty list —
    // that would misstate a caseload of zero as a caseload hidden by a filter.
    expect(container.textContent ?? "").not.toContain("Why:");
    expect(container.textContent ?? "").not.toContain("What changes it:");
  });

  it("renders no action when none is given", () => {
    const { container } = render(
      <ListEmptyState kind="no-data" heading="No patients yet" explanation="Nothing here." />,
    );
    expect(container.querySelector("a, button")).toBeNull();
  });

  it("renders the given action, and it is genuinely actionable", () => {
    render(
      <ListEmptyState
        kind="no-data"
        heading="No patients yet"
        explanation="Add the first patient to get started."
        action={<Link href="/caring-contacts/patients/new">Add a patient</Link>}
      />,
    );
    const action = screen.getByRole("link", { name: "Add a patient" });
    expect(action).toHaveAttribute("href", "/caring-contacts/patients/new");
  });

  it("names the whole state with a role=group, the same way automated-state.tsx does", () => {
    render(<ListEmptyState kind="no-data" heading="No patients yet" explanation="Nothing here." />);
    const region = screen.getByRole("group", { name: "No patients yet" });
    expect(region).toHaveTextContent("Nothing here.");
  });
});

describe("ListEmptyState — filtered", () => {
  it("renders both the reason and the remedy in the page, never in a title alone", () => {
    // Mirrors how tests/caring-contacts-explained-automation.dom.test.tsx proves
    // AutomatedState's reason and remedy are not tooltip-only: nothing here may
    // be reachable only by hovering a `title`.
    const { container } = render(
      <ListEmptyState
        kind="filtered"
        heading="No patients match"
        because="The status filter is set to Discharged this week."
        changedBy="Clear the status filter to see the rest of the caseload."
      />,
    );
    expect(container.textContent ?? "").toContain("Why:");
    expect(container.textContent ?? "").toContain("The status filter is set to Discharged this week.");
    expect(container.textContent ?? "").toContain("What changes it:");
    expect(container.textContent ?? "").toContain("Clear the status filter to see the rest of the caseload.");
    for (const node of container.querySelectorAll("[title]")) {
      expect(node.getAttribute("title")).not.toContain("The status filter is set to Discharged this week.");
      expect(node.getAttribute("title")).not.toContain("Clear the status filter to see the rest of the caseload.");
    }
  });

  it("cannot be constructed without a reason and a remedy", () => {
    // A type-level guarantee, checked by `tsc --noEmit` rather than at runtime:
    // the discriminated union makes `because`/`changedBy` required the moment
    // `kind` is "filtered", so an omission is a compile error, not a judgement
    // call left to whoever writes the next list screen.
    const omittedBecause = (
      // @ts-expect-error "filtered" requires `because` — it cannot be left out.
      <ListEmptyState kind="filtered" heading="No patients match" changedBy="Clear the status filter." />
    );
    const omittedChangedBy = (
      // @ts-expect-error "filtered" requires `changedBy` — it cannot be left out.
      <ListEmptyState kind="filtered" heading="No patients match" because="The status filter hides everyone." />
    );
    expect(omittedBecause).toBeTruthy();
    expect(omittedChangedBy).toBeTruthy();
  });

  it("renders the given action, and it is genuinely actionable", () => {
    render(
      <ListEmptyState
        kind="filtered"
        heading="No patients match"
        because="The status filter is set to Discharged this week."
        changedBy="Clear the status filter to see the rest of the caseload."
        action={<Link href="/caring-contacts/patients">Clear filter</Link>}
      />,
    );
    const action = screen.getByRole("link", { name: "Clear filter" });
    expect(action).toHaveAttribute("href", "/caring-contacts/patients");
  });

  it("groups the heading, the reason and the remedy under one role=group named by the heading", () => {
    // Ruling 81 forbade rendering AutomatedState, not reusing the accessible
    // structure that makes AutomatedState's reason and remedy reachable
    // together: a screen reader that reaches this named group finds "Why:"
    // and "What changes it:" without hunting elsewhere on the page.
    render(
      <ListEmptyState
        kind="filtered"
        heading="No patients match"
        because="The status filter is set to Discharged this week."
        changedBy="Clear the status filter to see the rest of the caseload."
      />,
    );
    const region = screen.getByRole("group", { name: "No patients match" });
    expect(region).toHaveTextContent("The status filter is set to Discharged this week.");
    expect(region).toHaveTextContent("Clear the status filter to see the rest of the caseload.");
  });
});

describe("ListEmptyState — rendering", () => {
  it("renders correctly inside a 320px-wide container", () => {
    const { container } = render(
      <div style={{ width: "320px" }}>
        <ListEmptyState
          kind="filtered"
          heading="No patients match"
          because="The status filter is set to Discharged this week, which happens to be a fairly long sentence."
          changedBy="Clear the status filter to see the rest of the caseload, which is also fairly long."
        />
      </div>,
    );
    // Text wraps rather than escaping its measure — the same contract
    // `automated-state.tsx` holds with `max-w-[var(--measure)]`.
    for (const paragraph of container.querySelectorAll("p")) {
      if (paragraph.textContent && paragraph.textContent.length > 40) {
        expect(paragraph.className).toContain("max-w-[var(--measure)]");
      }
    }
    expect(screen.getByText("No patients match")).toBeInTheDocument();
  });

  it("keeps its border visible under forced colours, the way automated-state.tsx does", () => {
    // jsdom cannot emulate `forced-colors: active`; real browser proof for this
    // family of guarantee lives in tests/ui-caring-contacts-workspace.spec.ts.
    // What this DOM test can and does prove is that the override class this
    // repo's forced-colors contract depends on is actually present in the
    // rendered markup, not merely written somewhere in the source.
    const { container } = render(
      <ListEmptyState kind="no-data" heading="No patients yet" explanation="Nothing here." />,
    );
    const region = container.firstElementChild;
    expect(region).not.toBeNull();
    expect(region!.className).toContain("forced-colors:border-[CanvasText]");
  });

  it("never carries the state by colour alone: the icon is decorative and the words are the state", () => {
    const { container } = render(
      <ListEmptyState kind="no-data" heading="No patients yet" explanation="Nothing here." />,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons, "no-data renders no icon").toHaveLength(1);
    for (const icon of icons) {
      expect(icon.getAttribute("aria-hidden")).toBe("true");
    }
  });
});

describe("ListEmptyState — not-permitted (Ruling 92)", () => {
  it("states a reason and a remedy, the same shape as filtered", () => {
    const { container } = render(
      <ListEmptyState
        kind="not-permitted"
        heading="Plans are not visible in this role"
        because="Viewing plans is not part of the role you are acting in."
        changedBy="Nothing on this screen changes it."
      />,
    );
    expect(screen.getByRole("group", { name: "Plans are not visible in this role" })).toBeInTheDocument();
    expect(container.textContent ?? "").toContain("Why:");
    expect(container.textContent ?? "").toContain("What changes it:");
  });

  it("never claims records exist, and never claims none do", () => {
    // The whole reason this kind exists: an actor without the capability and a team holding
    // nothing are answered identically by the stores, so this state may assert neither.
    const { container } = render(
      <ListEmptyState
        kind="not-permitted"
        heading="Plans are not visible in this role"
        because="Viewing plans is not part of the role you are acting in."
        changedBy="Nothing on this screen changes it."
      />,
    );
    // `"no-data"`'s wording shape must not leak in — it would state a caseload of zero.
    expect(container.textContent ?? "").not.toMatch(/\byet\b/);
  });

  it("does NOT reuse the search icon, which would report a search nobody ran", () => {
    // The icon is part of what states the difference wordlessly (this component's own rule), so
    // an icon shared with `"filtered"` is a false statement made without words.
    const filtered = render(
      <ListEmptyState kind="filtered" heading="No patients match" because="A filter." changedBy="Clear it." />,
    );
    const filteredIcon = filtered.container.querySelector("svg")?.getAttribute("class") ?? "";
    filtered.unmount();

    const restricted = render(
      <ListEmptyState
        kind="not-permitted"
        heading="Plans are not visible in this role"
        because="Not part of this role."
        changedBy="Nothing here."
      />,
    );
    const restrictedIcon = restricted.container.querySelector("svg")?.getAttribute("class") ?? "";

    expect(filteredIcon).not.toBe("");
    expect(restrictedIcon).not.toBe("");
    expect(restrictedIcon, "not-permitted reuses filtered's icon").not.toBe(filteredIcon);
  });

  it("keeps the icon decorative and the group named, like every other kind", () => {
    const { container } = render(
      <ListEmptyState
        kind="not-permitted"
        heading="Plans are not visible in this role"
        because="Not part of this role."
        changedBy="Nothing here."
      />,
    );
    const icons = container.querySelectorAll("svg");
    expect(icons).toHaveLength(1);
    expect(icons[0].getAttribute("aria-hidden")).toBe("true");
    expect(container.firstElementChild!.className).toContain("forced-colors:border-[CanvasText]");
  });
});
