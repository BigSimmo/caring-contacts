// tests/caring-contacts-templates-library.dom.test.tsx
//
// Phase 2B Task 15. The templates library
// (`src/components/caring-contacts/workspace/templates-library.tsx`) -- the screen that shows a
// team's governed pathway versions and the approvals behind them.
//
// THE TWO CONTRACTS THIS FILE EXISTS FOR
// --------------------------------------
//
//   1. A GOVERNANCE CLAIM IS NEVER LEFT UNQUALIFIED. "Approved by the clinical programme lead and
//      the lived-experience representative" is a claim about provenance, and a demonstration
//      population produces a version whose approvals are structurally genuine and whose governance
//      is invented. `PathwayVersionSnapshot.provenance` is the weakening-only marker that says so.
//      The defect this pins against is not hypothetical: in the sign-up wizard an UNRECOGNISED
//      provenance resolved to `undefined` from a plain map lookup, the `=== null` test read false,
//      and the screen rendered an EMPTY qualifier beside an approval line left standing. The
//      Postgres store reads the snapshot back with an unchecked `as`, so an unrecognised string is
//      a value this code can really receive. Every one of the three provenance shapes is asserted
//      below -- absent, recognised, and unrecognised -- with the unrecognised one held to the
//      synthetic WORDING rather than merely to "something rendered".
//
//   2. THE EMPTY LISTS DO NOT COLLAPSE. A library with no versions at all, a library filtered to a
//      state that has none, a library whose versions are all retired, and a library the acting role
//      may not read are four different facts with four different remedies. Each is held to its own
//      expected content AND to being different from each of the others, so an edit that made any
//      two say the same thing goes red. Holding them only against each other would not do: three
//      empty strings agree perfectly, which is exactly how Task 9b's mutation stayed green.
//
// NO MESSAGE WORDING IS SHOWN, and that is asserted rather than assumed. Ruling [127]: there is one
// approved specimen message for the programme and no per-version content anywhere, so a library
// that printed wording beside a version would claim a relationship that does not exist. The
// fixtures below carry a distinctive marker string in `messageTextByType` and the assertions
// require it never to reach the document.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  TemplatesLibrary,
  parseTemplatesLibraryFilter,
  templateLifecycleOf,
  templatesLibraryHref,
  type TemplatesLibraryFilter,
} from "@/components/caring-contacts/workspace/templates-library";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { actorId, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import type { MessageType, PathwayVersionState } from "@/lib/caring-contacts/model";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  PATHWAY_VERSION_PROVENANCE_WORDING,
  type PathwayApproval,
  type PathwayVersion,
  type PathwayVersionProvenance,
  type PathwayRetirementUrgency,
} from "@/lib/caring-contacts/pathway-versions";

const TEAM = teamId("templates-test-team");

/**
 * A marker no screen may print. It stands where a real message's wording would be, so an assertion
 * that it is absent is an assertion that no message wording reached the document -- which a check
 * against the real specimen could not make as sharply, since that string could plausibly appear in
 * a future explanatory sentence.
 */
const MESSAGE_TEXT_MARKER = "MESSAGE-BODY-THAT-MUST-NEVER-RENDER";

const BOTH_APPROVALS: readonly PathwayApproval[] = Object.freeze([
  {
    role: "clinicalProgrammeLead",
    actorId: actorId("demo-clinical-programme-lead"),
    approvedAt: "2026-08-14T09:00:00+08:00",
  },
  {
    role: "livedExperienceRepresentative",
    actorId: actorId("demo-lived-experience-representative"),
    approvedAt: "2026-08-14T10:00:00+08:00",
  },
]);

function version(
  id: string,
  state: PathwayVersionState,
  overrides: Partial<PathwayVersion> & { provenance?: string; heldMessageTypes?: readonly string[] } = {},
): PathwayVersion {
  const { provenance, heldMessageTypes, ...rest } = overrides;
  const held = heldMessageTypes ?? ["standard"];
  return {
    id: pathwayVersionId(id),
    teamId: TEAM,
    state,
    authorId: actorId("demo-coordinator"),
    approvals: state === "draft" || state === "inReview" ? [] : BOTH_APPROVALS,
    publishedAt: state === "approved" || state === "retired" ? "2026-08-14T11:00:00+08:00" : null,
    retiredAt: state === "retired" ? "2026-08-20T11:00:00+08:00" : null,
    retirementUrgency: state === "retired" ? ("routine" as PathwayRetirementUrgency) : null,
    snapshot: Object.freeze({
      cadenceLabels: Object.freeze(["Week 1", "Week 2"]),
      messageTextByType: Object.freeze({
        first: held.includes("first") ? MESSAGE_TEXT_MARKER : "",
        standard: held.includes("standard") ? MESSAGE_TEXT_MARKER : "",
        closing: held.includes("closing") ? MESSAGE_TEXT_MARKER : "",
      }),
      // The cast is the whole point of the unrecognised-provenance cases below, and it is the SAME
      // cast the Postgres reader makes on every snapshot it reads back. Narrowing it here would be
      // asserting the compiler's claim rather than the store's behaviour.
      ...(provenance === undefined ? {} : { provenance: provenance as PathwayVersionProvenance }),
    }),
    ...rest,
  };
}

const NO_FILTER: TemplatesLibraryFilter = { lifecycle: "all" };

function renderLibrary(versions: readonly PathwayVersion[], filter = NO_FILTER, mayView = true) {
  return render(<TemplatesLibrary versions={versions} filter={filter} mayViewPathwayVersions={mayView} />);
}

/**
 * The rendered text of the one and only empty state, whichever kind it is.
 *
 * `ListEmptyState` is the sole `role="group"` this screen renders -- the all-retired notice is a
 * `role="note"`, deliberately, because it is not an empty state at all -- so this reads the empty
 * state without matching on its words, which is what lets the comparison below be about the words.
 */
function emptyStateText(): string {
  const groups = screen.getAllByRole("group");
  expect(groups.length, "expected exactly one empty state on screen").toBe(1);
  return groups[0].textContent ?? "";
}

describe("the templates library never lets a governance claim stand unqualified", () => {
  it("qualifies a seeded version's approvals with the provenance the record carries", () => {
    renderLibrary([version("demo-seed-pathway-version-1", "approved", { provenance: "syntheticDemonstration" })]);

    const note = screen.getByTestId("caring-contacts-pathway-provenance");
    expect(note).toHaveTextContent(PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration);
    // The claim and its qualifier are both present, in that order, inside the same row.
    const row = note.closest("li");
    expect(row, "the provenance note is not inside a version row").not.toBeNull();
    expect(row!.textContent).toContain(PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead);
    expect(row!.textContent).toContain(PATHWAY_APPROVAL_ROLE_WORDING.livedExperienceRepresentative);
  });

  it("falls back to the synthetic wording for a provenance value this build does not recognise", () => {
    // The value a future record, a hand-edited row, or a store from a later build could hold. It is
    // reachable precisely because the Postgres reader casts rather than validates.
    renderLibrary([version("SYN-PATHWAY-UNKNOWN", "approved", { provenance: "someMarkerFromALaterBuild" })]);

    const note = screen.getByTestId("caring-contacts-pathway-provenance");
    // Held to the WORDING, not to "an element exists": the sign-up defect rendered an element whose
    // text was empty, which an existence check would have passed.
    expect(note.textContent?.trim()).not.toBe("");
    expect(note).toHaveTextContent(PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration);
    // And the raw stored marker is never shown to a clinician in place of plain words.
    expect(screen.queryByText(/someMarkerFromALaterBuild/)).toBeNull();
  });

  it("falls back for the provenance values that resolve through Object.prototype rather than the map", () => {
    // `constructor` would resolve to a function under a truthiness test on a plain object literal.
    // The resolver uses `Object.hasOwn`; this is the screen-level half of that guarantee.
    for (const inherited of ["constructor", "toString", "__proto__"]) {
      const { unmount } = renderLibrary([version(`SYN-PATHWAY-${inherited}`, "approved", { provenance: inherited })]);
      const note = screen.getByTestId("caring-contacts-pathway-provenance");
      expect(note, `provenance "${inherited}" lost its qualification`).toHaveTextContent(
        PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
      );
      unmount();
    }
  });

  it("claims nothing about provenance when the record claims nothing, and still states the approvals", () => {
    renderLibrary([version("SYN-PATHWAY-REAL", "approved")]);

    // Absence asserts nothing -- that is the documented invariant of the marker, and rendering the
    // synthetic wording here would be a false statement about a record that may be genuine.
    expect(screen.queryByTestId("caring-contacts-pathway-provenance")).toBeNull();
    expect(screen.getByRole("listitem").textContent).toContain(PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead);
  });

  it("names the approval seats in plain words, never as a role identifier", () => {
    renderLibrary([version("SYN-PATHWAY-REAL", "approved")]);

    const row = screen.getByRole("listitem").textContent ?? "";
    expect(row).toContain("the clinical programme lead");
    expect(row).not.toContain("clinicalProgrammeLead");
    expect(row).not.toContain("livedExperienceRepresentative");
  });

  it("says an approval is unrecorded rather than printing an empty approval sentence", () => {
    renderLibrary([version("SYN-PATHWAY-DRAFT", "draft")]);

    expect(screen.getByRole("listitem").textContent).toContain("No approval has been recorded on this version.");
  });
});

describe("the templates library shows the governance record and no message wording", () => {
  it("never renders a version's message text", () => {
    const { container } = renderLibrary([
      version("SYN-PATHWAY-001", "approved", { heldMessageTypes: ["first", "standard", "closing"] }),
    ]);

    // THE POSITIVE CONTROL. The assertion below is an absence, and an empty render satisfies an
    // absence perfectly -- a filter that hid the row, a fixture that built no version, a component
    // that returned null would all pass it while examining nothing. So the row and the sentence
    // that stands where the wording would go are required to be here first.
    expect(container.querySelectorAll("li").length, "no version row rendered — the absence proves nothing").toBe(1);
    expect(container.textContent).toContain("Wording is held for");

    expect(container.textContent).not.toContain(MESSAGE_TEXT_MARKER);
  });

  it("states which of the three messages the record holds wording for, and which are unwritten", () => {
    renderLibrary([version("SYN-PATHWAY-001", "approved", { heldMessageTypes: ["standard"] })]);

    const row = screen.getByRole("listitem").textContent ?? "";
    expect(row).toContain("Wording is held for the standard message.");
    expect(row).toContain("Nothing has been written for the first message and the closing message.");
  });

  it("treats a message type missing from the stored snapshot as unwritten rather than as held", () => {
    // The unchecked cast again: a key absent from the stored object arrives as `undefined` with the
    // type saying it cannot. Overstating what the record holds is the direction that must not happen.
    const incomplete = version("SYN-PATHWAY-PARTIAL", "approved");
    const withMissingKey: PathwayVersion = {
      ...incomplete,
      snapshot: Object.freeze({
        ...incomplete.snapshot,
        messageTextByType: Object.freeze({ standard: MESSAGE_TEXT_MARKER }) as unknown as Readonly<
          Record<MessageType, string>
        >,
      }),
    };

    renderLibrary([withMissingKey]);

    const row = screen.getByRole("listitem").textContent ?? "";
    expect(row).toContain("Nothing has been written for the first message and the closing message.");
  });
});

describe("the templates library distinguishes the lifecycle states from one another", () => {
  const everyState: readonly PathwayVersion[] = [
    version("SYN-PATHWAY-CURRENT", "approved"),
    version("SYN-PATHWAY-DRAFT", "draft"),
    version("SYN-PATHWAY-INREVIEW", "inReview"),
    version("SYN-PATHWAY-RETIRED", "retired"),
  ];

  it("groups the domain's four states onto the three the design shows, without hiding which is which", () => {
    // approved, draft, inReview, retired -- the two Pending members are the point: `draft` and
    // `inReview` land in one group, and the rows below are what keeps them distinguishable.
    expect(everyState.map(templateLifecycleOf)).toEqual(["current", "pending", "pending", "retired"]);

    renderLibrary(everyState);
    const rows = screen.getAllByRole("listitem");
    // `draft` and `inReview` share the Pending chip, so each row states its own recorded state.
    expect(within(rows[1]).getByText("Drafted, not yet submitted for review")).toBeInTheDocument();
    expect(within(rows[2]).getByText("In review, awaiting both approvals")).toBeInTheDocument();
  });

  it("states publication and retirement as recorded facts rather than inferring them from the state", () => {
    renderLibrary(everyState);
    const rows = screen.getAllByRole("listitem");

    expect(rows[0].textContent).toContain("Published 2026-08-14 (AWST).");
    expect(rows[1].textContent).toContain("Not published.");
    expect(rows[3].textContent).toContain("Retired 2026-08-20 (AWST) as a routine change.");
    expect(rows[0].textContent).toContain("Not retired.");
  });

  it("says what an urgent-safety retirement means for plans already running", () => {
    renderLibrary([
      version("SYN-PATHWAY-URGENT", "retired", { retirementUrgency: "urgentSafety" as PathwayRetirementUrgency }),
    ]);

    const row = screen.getByRole("listitem").textContent ?? "";
    expect(row).toContain("urgent safety matter");
    expect(row).toContain("paused for review");
  });

  it("keeps an approved-but-unpublished version distinguishable from a published one", () => {
    renderLibrary([version("SYN-PATHWAY-UNPUBLISHED", "approved", { publishedAt: null })]);

    expect(screen.getByRole("listitem").textContent).toContain("Approved, and not yet published.");
  });

  it("filters to one lifecycle group from the URL, and builds every href from the route module", () => {
    expect(parseTemplatesLibraryFilter({ lifecycle: "retired" })).toEqual({ lifecycle: "retired" });
    // A repeated parameter names no single group, and an unrecognised one must widen rather than throw.
    expect(parseTemplatesLibraryFilter({ lifecycle: ["current", "retired"] })).toEqual({ lifecycle: "all" });
    expect(parseTemplatesLibraryFilter({ lifecycle: "archived" })).toEqual({ lifecycle: "all" });
    expect(templatesLibraryHref({ lifecycle: "all" })).toBe(CARING_CONTACTS_ROUTES.templates);
    expect(templatesLibraryHref({ lifecycle: "pending" })).toBe(
      `${CARING_CONTACTS_ROUTES.templates}?lifecycle=pending`,
    );

    renderLibrary(everyState, { lifecycle: "current" });
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("SYN-PATHWAY-CURRENT");
  });
});

describe("the templates library's empty lists are four different facts", () => {
  const retiredOnly = [version("SYN-PATHWAY-RETIRED", "retired")];
  const mixed = [version("SYN-PATHWAY-CURRENT", "approved"), version("SYN-PATHWAY-RETIRED", "retired")];

  function textFor(versions: readonly PathwayVersion[], filter: TemplatesLibraryFilter, mayView = true): string {
    const { unmount } = renderLibrary(versions, filter, mayView);
    const text = emptyStateText();
    unmount();
    return text;
  }

  it("says nothing exists when nothing exists", () => {
    const text = textFor([], NO_FILTER);
    expect(text).toContain("No governed versions yet");
    expect(text).toContain("not a draft, not a retired one, nothing");
  });

  it("says the filter is hiding records, and offers the control that clears it", () => {
    renderLibrary(mixed, { lifecycle: "pending" });
    const text = emptyStateText();
    expect(text).toContain("The lifecycle filter is set to Pending");
    expect(text).toContain("none of the versions this team holds is in that state. Others are.");
    expect(screen.getByRole("link", { name: "Show every version" })).toHaveAttribute(
      "href",
      CARING_CONTACTS_ROUTES.templates,
    );
  });

  it("says a library filtered to Current with everything retired is a different fact from a filter with records behind it", () => {
    const text = textFor(retiredOnly, { lifecycle: "current" });
    expect(text).toContain("every version this team holds has been retired");
    // The remedy is the part that must not be borrowed from the ordinary filtered case: clearing
    // the filter reveals retired records and still leaves nothing a plan can be started on.
    expect(text).toContain("It does not make one available for a new plan");
  });

  it("says a role restriction is a role restriction, and claims nothing about how many records exist", () => {
    const text = textFor(mixed, NO_FILTER, false);
    expect(text).toContain("Governed versions are not visible in this role");
    expect(text).toContain("This says nothing about how many versions this team holds");
  });

  it("holds all four apart from one another, so no two may collapse into the same words", () => {
    // BOTH FILTERED CASES USE THE SAME LIFECYCLE FILTER, and that is the whole strength of this
    // check rather than a tidiness choice. Every filtered empty state interpolates its filter's
    // label, so two branches holding word-for-word identical prose still render DIFFERENT text when
    // the fixtures ask for different filters -- and this comparison passed while the all-retired
    // branch had been overwritten with the ordinary one, which a mutation found. Pinning both to
    // `pending` removes the label as a source of difference, so the only thing left that can differ
    // is the prose the branches were written to say.
    const facts = {
      "no data": textFor([], NO_FILTER),
      filtered: textFor(mixed, { lifecycle: "pending" }),
      "all retired": textFor(retiredOnly, { lifecycle: "pending" }),
      "not permitted": textFor(mixed, NO_FILTER, false),
    };

    // Each side is already held to its own expected content above; this is the pairwise half, and
    // it is what goes red if an edit makes any two of them say the same thing.
    const entries = Object.entries(facts);
    for (const [nameA, textA] of entries) {
      expect(textA.trim(), `${nameA} rendered no words at all`).not.toBe("");
      for (const [nameB, textB] of entries) {
        if (nameA === nameB) continue;
        expect(textA, `"${nameA}" and "${nameB}" render the same empty state`).not.toBe(textB);
      }
    }
  });

  it("states above a full list that every version this team holds has been retired", () => {
    // NOT an empty state: the list below is full, and this is the fact none of its rows states.
    renderLibrary(retiredOnly, NO_FILTER);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    const notice = screen.getByRole("note", { name: "No version is available for a new plan" });
    expect(notice.textContent).toContain("Every version this team holds has been retired.");
    expect(notice.textContent).toContain("A new version has to be written and approved by two people.");
  });

  it("does not claim every version is retired when one is not", () => {
    renderLibrary(mixed, NO_FILTER);
    expect(screen.queryByRole("note", { name: "No version is available for a new plan" })).toBeNull();
  });

  it("shows no filter controls at all to a role that may not read a version", () => {
    renderLibrary(mixed, NO_FILTER, false);
    expect(screen.queryByRole("navigation", { name: "Filter by lifecycle state" })).toBeNull();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("the templates library navigates and sizes the way this workspace requires", () => {
  it("uses Link for every internal destination, and no raw anchor to an internal route", () => {
    const { container } = renderLibrary([version("SYN-PATHWAY-CURRENT", "approved")]);
    const anchors = [...container.querySelectorAll("a[href^='/']")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
      expect(anchor.getAttribute("href")?.startsWith(CARING_CONTACTS_ROUTES.templates)).toBe(true);
    }
  });

  it("puts the tap-target minimum on the element containing each control, never min-h-11", () => {
    const { container } = renderLibrary([version("SYN-PATHWAY-CURRENT", "approved")]);
    for (const anchor of container.querySelectorAll("a[href^='/']")) {
      expect(anchor.className, `${anchor.textContent} is not a tap target`).toContain("min-h-tap");
      expect(anchor.className).not.toContain("min-h-11");
    }
  });

  /**
   * A STATIC PROXY FOR TWO BROWSER PROOFS, LABELLED AS ONE.
   *
   * Forced-colors and a 320px viewport are browser facts and these are not browser assertions: they
   * read the class list of a jsdom render, where no media query and no forced-colors mode is ever
   * evaluated. They catch the two regressions that are mechanically visible in the markup -- a
   * bordered surface that would vanish in forced-colors, and a fixed pixel width that would push a
   * 320px viewport into a horizontal scroll -- and they prove nothing about how any of it paints.
   * The browser half is the `caring-contacts templates library` block in
   * `tests/ui-caring-contacts-workspace.spec.ts`.
   *
   * ONE SCENARIO LIST FOR BOTH, and that is the point rather than tidiness. Each check reads the
   * class list of whatever happens to be rendered, so what it examines is decided entirely by the
   * fixture -- and a fixture that renders none of the surface under test passes while examining
   * nothing. Every scenario therefore carries its OWN positive control naming the surface it exists
   * to put on screen, and both checks walk all of them.
   */
  const surfaceScenarios: readonly {
    name: string;
    open: () => ReturnType<typeof renderLibrary>;
    /** What this fixture exists to render. Fails loudly rather than letting the check go vacuous. */
    present: (container: HTMLElement) => void;
  }[] = [
    {
      name: "a version row",
      open: () => renderLibrary([version("SYN-PATHWAY-CURRENT", "approved")]),
      present: (container) => {
        expect(container.querySelectorAll("li").length, "no version row rendered").toBeGreaterThan(0);
      },
    },
    {
      name: "an empty state and the all-retired notice",
      open: () => renderLibrary([version("SYN-PATHWAY-RETIRED", "retired")], { lifecycle: "pending" }),
      present: (container) => {
        expect(within(container).getAllByRole("group").length, "no empty state rendered").toBeGreaterThan(0);
        expect(
          within(container).getByRole("note", { name: "No version is available for a new plan" }),
        ).toBeInTheDocument();
      },
    },
  ];

  it("gives every bordered surface a forced-colors fallback, so none of them vanishes", () => {
    // THE VACUITY GUARDS ABOVE WERE BOUGHT BY TWO MUTATIONS, ONE OF THEM AT REVIEW. The first
    // version of this check rendered a single library -- a retired version under a Pending filter,
    // which is an empty list -- so no row was in the document at all, and stripping the fallback
    // from the row left the check green: `bordered.length > 0` was satisfied by the filter chips
    // alone. Adding a row scenario fixed that case and left the SAME hole in the second one, where
    // the chips again satisfy the count while the notice this fixture exists for may not be there.
    // A "there is something here" guard never establishes that the right something is here.
    for (const { name, open, present } of surfaceScenarios) {
      const { container, unmount } = open();
      present(container);

      const bordered = [...container.querySelectorAll("[class*='border-[color:var(--border)]']")];
      expect(bordered.length, `${name} draws no border — the check would be vacuous`).toBeGreaterThan(0);
      for (const element of bordered) {
        // `getAttribute("class")`, not `.className`: on an SVG element the latter is an
        // `SVGAnimatedString` object rather than a string, and the matcher would be reading the
        // wrong thing without saying so.
        expect(
          element.getAttribute("class") ?? "",
          `${name}: ${element.tagName} draws a border with no forced-colors fallback`,
        ).toContain("forced-colors:border-[CanvasText]");
      }
      unmount();
    }
  });

  it("sets no fixed pixel width anywhere, so 320px has nothing to overflow", () => {
    // Walks the same scenarios for the same reason: rendering only a version row would leave a
    // fixed width added to the empty state or to the all-retired notice outside what this reads.
    for (const { name, open, present } of surfaceScenarios) {
      const { container, unmount } = open();
      present(container);

      const classed = [...container.querySelectorAll("[class]")];
      expect(classed.length, `${name} carries no class — the check would be vacuous`).toBeGreaterThan(0);
      for (const element of classed) {
        expect(element.getAttribute("class") ?? "", `${name}: ${element.tagName} carries a fixed width`).not.toMatch(
          /\b(min-)?w-\[[0-9]/,
        );
      }
      unmount();
    }
  });
});
