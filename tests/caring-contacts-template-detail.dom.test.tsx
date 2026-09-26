// tests/caring-contacts-template-detail.dom.test.tsx
//
// Phase 2B Task 16. `src/components/caring-contacts/workspace/template-detail.tsx` -- ONE governed
// pathway version, in full.
//
// WHAT THIS FILE PROVES, AND THE SHAPE EVERY ASSERTION IN IT IS WRITTEN TO HAVE
// ----------------------------------------------------------------------------
// The screen makes three claims a clinician could act on, and each is proved both directions:
//
//   * THE GOVERNANCE CLAIM. Both approval seats, their roles in words, and the qualification the
//     record's own provenance carries. The resolver's contract is asymmetric on purpose -- absent
//     claims nothing, unrecognised falls back to the weakening wording -- and the two halves are
//     pinned separately, because collapsing them is a change in what the screen ASSERTS about a
//     record nobody approved.
//   * THE WORDING CLAIM. This screen shows the wording, which the library deliberately does not.
//     So the falsifiable pair here is the opposite way round from the library's: the wording the
//     record holds MUST reach the document, exactly once, inside the region that says what it is
//     -- and the framing that stops it reading as a message prepared for a person must be there
//     with it. A test that only asserted absence would pass on a screen that had quietly dropped
//     the record's contents.
//   * THE REPLY-HANDLING CLAIM. Read from the sealed domain, so the owner's copy decisions of
//     2026-08-24 travel; and the superseded sentences those decisions replaced are asserted
//     ABSENT, which is the half that goes red if anyone ever hardcodes the older text.
//
// Every absence in this file sits beside a positive control that puts the thing it is about within
// reach. An absence asserted over a fixture that could not have produced the value proves nothing,
// which is the trap the templates library fell into and corrected.
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { TemplateDetail, type TemplateDetailView } from "@/components/caring-contacts/workspace/template-detail";
import { WorkspaceOverlays } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { WORKSPACE_OVERLAY_DEFINITIONS } from "@/components/caring-contacts/workspace/overlays/definitions";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { actorId, pathwayVersionId, teamId } from "@/lib/caring-contacts/ids";
import {
  AUTOMATED_REPLY_RESPONSE,
  CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
  PATIENT_VISIBLE_NO_REPLY_NOTICE,
} from "@/lib/caring-contacts/message-copy";
import type { MessageType, PathwayVersionState } from "@/lib/caring-contacts/model";
import {
  PATHWAY_APPROVAL_ROLE_WORDING,
  PATHWAY_VERSION_PROVENANCE_WORDING,
  type PathwayApproval,
  type PathwayApprovalRole,
  type PathwayVersion,
  type PathwayVersionProvenance,
  type PathwayVersionSnapshot,
} from "@/lib/caring-contacts/pathway-versions";

/**
 * A marker rather than the real specimen, in every fixture that is not about the seed.
 *
 * The real message is `EXACT_PATIENT_VISIBLE_MESSAGE`, and it is asserted against in the PAGE
 * test, where the demo seed puts it into the record. Here the point is that whatever the record
 * holds is what reaches the screen, and a string no other code can produce is the only fixture
 * that can prove "it came from the record" rather than "it came from somewhere".
 */
const HELD_STANDARD_WORDING = "WORDING-HELD-BY-THIS-RECORD-STANDARD";
const HELD_FIRST_WORDING = "WORDING-HELD-BY-THIS-RECORD-FIRST";

/**
 * The two sentences the owner's copy decisions A2 and A3 REPLACED, on 2026-08-24.
 *
 * Asserted absent, and that is the assertion with teeth in the reply-handling block: the current
 * strings are imported from `message-copy.ts`, so an assertion that they are present would still
 * pass if the module were edited, but a screen that had frozen the superseded wording into its own
 * source would go red here. A2 removed a firm claim about storage nobody can currently verify; A3
 * added that the automatic reply is automatic.
 */
const SUPERSEDED_NO_REPLY_NOTICE = "Replies are not received, stored, analysed or monitored";
const SUPERSEDED_REPLY_STORAGE_CLAIM = "has not been seen by anyone and has not been kept";

const APPROVAL_AT = "2026-03-01T09:00:00+08:00";
const OTHER_APPROVAL_AT = "2026-03-02T09:00:00+08:00";

function approval(role: PathwayApprovalRole, actor: string, approvedAt = APPROVAL_AT): PathwayApproval {
  return { role, actorId: actorId(actor), approvedAt };
}

const BOTH_SEATS: readonly PathwayApproval[] = Object.freeze([
  approval("clinicalProgrammeLead", "demo-clinicalProgrammeLead"),
  approval("livedExperienceRepresentative", "demo-livedExperienceRepresentative", OTHER_APPROVAL_AT),
]);

function snapshot(overrides: Partial<PathwayVersionSnapshot> = {}): PathwayVersionSnapshot {
  return Object.freeze({
    cadenceLabels: Object.freeze(["Day 1", "Week 2"]),
    messageTextByType: Object.freeze({
      standard: HELD_STANDARD_WORDING,
      first: "",
      closing: "",
    }) as Readonly<Record<MessageType, string>>,
    ...overrides,
  });
}

function version(overrides: Partial<PathwayVersion> = {}): PathwayVersion {
  const state: PathwayVersionState = overrides.state ?? "approved";
  return {
    id: pathwayVersionId("SYN-PATHWAY-001"),
    teamId: teamId("demo-team"),
    state,
    authorId: actorId("demo-coordinator"),
    approvals: BOTH_SEATS,
    publishedAt: state === "approved" || state === "retired" ? "2026-03-03T09:00:00+08:00" : null,
    retiredAt: state === "retired" ? "2026-03-10T09:00:00+08:00" : null,
    retirementUrgency: state === "retired" ? "routine" : null,
    snapshot: snapshot(),
    ...overrides,
  };
}

function renderDetail(view: TemplateDetailView) {
  return render(<TemplateDetail view={view} />);
}

function renderVersion(overrides: Partial<PathwayVersion> = {}) {
  return renderDetail({ kind: "version", version: version(overrides) });
}

/** Puts the record within reach before any absence is asserted about it. */
function theRecordRendered() {
  expect(screen.getByTestId("caring-contacts-template-detail-approval"), "no record rendered").toBeInTheDocument();
}

function bodyText(): string {
  return document.body.textContent ?? "";
}

/**
 * A `ListEmptyState`'s body text with its HEADING excluded.
 *
 * Fix round 1, MINOR 4. The comparison below read `group.textContent`, which INCLUDES the
 * heading, and the two headings are distinct string literals -- so the two values could never be
 * equal however identical the paragraphs beneath them became, and the assertion could not fail for
 * the reason its own comment gave. The heading is the group's `aria-label` and also its first
 * paragraph; dropping the paragraph that carries it leaves exactly the prose the comparison claims
 * to be about. The `action` node is a `<Link>` rather than a `<p>`, so it is outside this by
 * construction.
 */
function bodyOfEmptyState(group: HTMLElement): string {
  const heading = group.getAttribute("aria-label") ?? "";
  return [...group.querySelectorAll("p")]
    .map((paragraph) => paragraph.textContent ?? "")
    .filter((text) => text !== heading)
    .join(" ")
    .trim();
}

function occurrencesOf(needle: string): number {
  const text = bodyText();
  let count = 0;
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
}

afterEach(() => {
  // The overlay host writes `?overlay=` into the tab's history. Left behind, the next render in
  // this file would open with an overlay already on screen.
  window.history.replaceState(null, "", "/");
});

describe("the template detail record qualifies its approvals, or deliberately does not", () => {
  it("renders the qualification a record's own provenance carries", () => {
    renderVersion({ snapshot: snapshot({ provenance: "syntheticDemonstration" }) });

    // Positive control first: the approval sentence the qualification qualifies IS on screen, so
    // this cannot pass on a render that produced no approval at all.
    expect(screen.getByText(`Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead}`)).toBeInTheDocument();
    expect(screen.getByTestId("caring-contacts-template-detail-provenance")).toHaveTextContent(
      PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
    );
  });

  it("falls back to the weakening wording for a provenance this build cannot read", () => {
    // The store reads the snapshot back with an unchecked cast, so this is a value that really can
    // arrive, not a hypothetical. The safe reading of "I do not know what this claim says" is never
    // "it claims nothing" -- every value this field can hold is a weakening claim.
    renderVersion({
      snapshot: snapshot({ provenance: "trainingCopy" as PathwayVersionProvenance }),
    });

    theRecordRendered();
    expect(screen.getByTestId("caring-contacts-template-detail-provenance")).toHaveTextContent(
      PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
    );
  });

  it("falls back for an inherited key too, rather than rendering a function", () => {
    // `Object.hasOwn` in the resolver, not a truthiness test on the lookup: the wording map is a
    // frozen object literal, so `"constructor"` would otherwise resolve to `Object` itself.
    renderVersion({
      snapshot: snapshot({ provenance: "constructor" as PathwayVersionProvenance }),
    });

    theRecordRendered();
    expect(screen.getByTestId("caring-contacts-template-detail-provenance")).toHaveTextContent(
      PATHWAY_VERSION_PROVENANCE_WORDING.syntheticDemonstration,
    );
  });

  it("claims NOTHING about provenance when the record claims nothing", () => {
    // Absent is not unrecognised, and the difference is deliberate. Stamping "invented for
    // demonstration" onto a record whose provenance says nothing would be a false statement about
    // a possibly genuine one. The element must be ABSENT rather than present and empty -- a `===
    // null` test on the resolver's result is what makes those two indistinguishable at the call
    // site, and it is the shape of the defect found in the sign-up wizard.
    renderVersion({ snapshot: snapshot() });

    theRecordRendered();
    expect(screen.getByText(`Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead}`)).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-template-detail-provenance")).toBeNull();
  });
});

describe("dual approval is stated seat by seat, in words, and never as an identifier", () => {
  it("names both seats and says the two are different people", () => {
    renderVersion({ snapshot: snapshot({ provenance: "syntheticDemonstration" }) });

    const approvalCard = screen.getByTestId("caring-contacts-template-detail-approval");
    expect(
      within(approvalCard).getByText(`Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead}`),
    ).toBeInTheDocument();
    expect(
      within(approvalCard).getByText(`Approved by ${PATHWAY_APPROVAL_ROLE_WORDING.livedExperienceRepresentative}`),
    ).toBeInTheDocument();
    expect(approvalCard.textContent).toContain("Both seats are recorded here, each by a different person.");
    // Each seat carries the day its approval was recorded, and the two fixtures differ, so a screen
    // reading one approval for both seats would print the same day twice.
    expect(approvalCard.textContent).toContain("Recorded 2026-03-01 (AWST).");
    expect(approvalCard.textContent).toContain("Recorded 2026-03-02 (AWST).");
  });

  it("renders no raw role identifier and no actor identifier anywhere on the record", () => {
    renderVersion({ snapshot: snapshot({ provenance: "syntheticDemonstration" }) });

    // The positive control is the pair above: the WORDING for both seats is on screen, so this
    // absence is being asserted over a render that really did have both identifiers in its props.
    theRecordRendered();
    expect(bodyText()).toContain(PATHWAY_APPROVAL_ROLE_WORDING.clinicalProgrammeLead);
    expect(bodyText()).toContain(PATHWAY_APPROVAL_ROLE_WORDING.livedExperienceRepresentative);

    for (const identifier of [
      "clinicalProgrammeLead",
      "livedExperienceRepresentative",
      "demo-clinicalProgrammeLead",
      "demo-livedExperienceRepresentative",
      "demo-coordinator",
    ]) {
      expect(bodyText(), `${identifier} reached the screen as a raw identifier`).not.toContain(identifier);
    }
  });

  it("says which seat has not recorded an approval, rather than showing one seat and stopping", () => {
    renderVersion({
      state: "inReview",
      approvals: [approval("clinicalProgrammeLead", "demo-clinicalProgrammeLead")],
    });

    const approvalCard = screen.getByTestId("caring-contacts-template-detail-approval");
    // The seat that DID approve still carries its day -- the positive control for the absence
    // beside it, so this cannot pass on a card that rendered neither seat.
    expect(approvalCard.textContent).toContain("Recorded 2026-03-01 (AWST).");
    expect(approvalCard.textContent).toContain("Not recorded on this version.");
    expect(approvalCard.textContent).toContain("One of them has not been recorded on this version.");
  });

  it("does not call two approvals two people when the record shows one person twice", () => {
    // `applyPathwayVersionTransition` refuses this, and this screen reads a record BACK through the
    // same unchecked cast everything else here allows for. A dual approval one person gave twice is
    // the exact failure this surface reports on, so it is derived from the record rather than
    // assumed from the state.
    renderVersion({
      approvals: [
        approval("clinicalProgrammeLead", "demo-same-person"),
        approval("livedExperienceRepresentative", "demo-same-person", OTHER_APPROVAL_AT),
      ],
    });

    const approvalCard = screen.getByTestId("caring-contacts-template-detail-approval");
    expect(approvalCard.textContent).toContain(
      "Both seats are recorded here, and this record shows the same person against more than one of them.",
    );
    expect(approvalCard.textContent).not.toContain("each by a different person");
  });
});

describe("the wording this record holds reaches the screen, framed as what it is", () => {
  it("renders the held wording verbatim, exactly once, inside the region that names it", () => {
    renderVersion({
      snapshot: snapshot({
        messageTextByType: Object.freeze({
          standard: HELD_STANDARD_WORDING,
          first: HELD_FIRST_WORDING,
          closing: "",
        }) as Readonly<Record<MessageType, string>>,
      }),
    });

    // The direction that matters on THIS screen, and the opposite of the library's: the record's
    // contents must arrive. A screen that had quietly dropped them would pass an absence test.
    const standard = screen.getByTestId("caring-contacts-template-detail-wording-standard");
    expect(standard).toHaveTextContent(HELD_STANDARD_WORDING);
    expect(screen.getByTestId("caring-contacts-template-detail-wording-first")).toHaveTextContent(HELD_FIRST_WORDING);

    // Exactly once, and inside the labelled quotation rather than also in a heading or a summary:
    // patient-visible wording repeated up a governance screen is how it stops reading as a record
    // and starts reading as a message.
    expect(occurrencesOf(HELD_STANDARD_WORDING), "the held wording appears more than once").toBe(1);
    expect(occurrencesOf(HELD_FIRST_WORDING)).toBe(1);

    // And the framing that stops it reading as a message prepared for somebody.
    expect(bodyText()).toContain("Read from this version's own record.");
    expect(bodyText()).toContain("Nothing below is addressed to anybody");
  });

  it("shows nothing for a message type the record has not written, and says so", () => {
    renderVersion();

    // Positive control: the one type this record DOES hold is on screen, so the two absences below
    // are asserted over a render that really produced a wording region.
    expect(screen.getByTestId("caring-contacts-template-detail-wording-standard")).toHaveTextContent(
      HELD_STANDARD_WORDING,
    );
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-first")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-closing")).toBeNull();
    expect(bodyText()).toContain("Nothing has been written for the first message and the closing message.");
  });

  it("treats an absent key and an empty string alike, which is the direction that cannot overstate", () => {
    // The store's unchecked cast means a key absent from the stored object arrives as `undefined`
    // with the type saying it cannot. A truthiness test would be enough for the empty string and
    // would throw on the missing key; the `typeof … === "string"` guard covers both.
    renderVersion({
      snapshot: snapshot({
        messageTextByType: Object.freeze({ standard: "   " }) as unknown as Readonly<Record<MessageType, string>>,
      }),
    });

    theRecordRendered();
    expect(bodyText()).toContain("This record holds no message wording at all.");
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-standard")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-first")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-template-detail-wording-closing")).toBeNull();
  });
});

/**
 * RULING [131]. Round 1 rendered, directly beneath the two approval seats, a sentence saying the
 * one patient-visible message HAD been approved. `message-copy.ts` opens by saying the opposite,
 * and names as the owner of that decision the very two seats the card above was displaying. The
 * sentence was deleted; the wording's real status is now READ from beside the words it is about.
 *
 * Three assertions, because the defect had three halves. That the status reaches the screen at
 * all; that the card makes no OTHER claim about approval, which is the half that goes red if the
 * deleted sentence is ever restored in any wording; and that a seat is never named without the
 * status, which is the adjacency that made the original sentence dangerous rather than merely
 * wrong.
 */
describe("the wording's approval status is stated where the wording is (Ruling [131])", () => {
  it("reads the status from the sealed domain rather than retyping it", () => {
    renderVersion();

    // Positive control: the wording this status is ABOUT really is on screen, so the status is not
    // being asserted over a card that rendered nothing.
    expect(screen.getByTestId("caring-contacts-template-detail-wording-standard")).toHaveTextContent(
      HELD_STANDARD_WORDING,
    );
    expect(screen.getByTestId("caring-contacts-template-detail-wording-status")).toHaveTextContent(
      CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
    );
  });

  it("makes no claim of its own about approval anywhere in that card", () => {
    renderVersion();

    const cardText = screen.getByTestId("caring-contacts-template-detail-wording").textContent ?? "";
    // Positive control for the removal below: the status IS in this card, so removing it really
    // shortens the string rather than leaving it untouched and the absence trivially true.
    expect(cardText).toContain(CLINICIAN_FACING_WORDING_APPROVAL_STATUS);
    const withoutTheSealedStatus = cardText.replace(CLINICIAN_FACING_WORDING_APPROVAL_STATUS, "");
    expect(withoutTheSealedStatus.length).toBeLessThan(cardText.length);

    // Anything else this card says about approval is the SCREEN claiming something about wording
    // nobody has approved. A word-stem match rather than the deleted sentence's own words: a guard
    // written around one phrasing would pass the next phrasing of the same false claim.
    expect(withoutTheSealedStatus, "the wording card makes its own claim about approval").not.toMatch(/approv/i);
  });

  it("never names an approval seat without stating the wording's status too", () => {
    const scenarios: readonly { name: string; open: () => ReturnType<typeof renderDetail> }[] = [
      { name: "a current version holding wording", open: () => renderVersion() },
      {
        name: "a version holding no wording at all",
        open: () =>
          renderVersion({
            snapshot: snapshot({
              messageTextByType: Object.freeze({ standard: "", first: "", closing: "" }) as Readonly<
                Record<MessageType, string>
              >,
            }),
          }),
      },
      { name: "a retired version", open: () => renderVersion({ state: "retired" }) },
    ];

    for (const { name, open } of scenarios) {
      const { unmount } = open();
      // The positive control, per scenario: a seat really IS named here, so the status requirement
      // below is being asserted over a render that carries the adjacency it is about.
      const seats = screen.getAllByText(/^Approved by /);
      expect(seats.length, `${name} names no approval seat — the check would be vacuous`).toBeGreaterThan(0);
      expect(bodyText(), `${name} names an approval seat with no status for the wording`).toContain(
        CLINICIAN_FACING_WORDING_APPROVAL_STATUS,
      );
      unmount();
    }
  });
});

describe("what a patient who replies is told comes from the sealed domain, not from this screen", () => {
  it("renders the current no-reply notice and the current automated response", () => {
    renderVersion();

    expect(screen.getByTestId("caring-contacts-template-detail-no-reply-notice")).toHaveTextContent(
      PATIENT_VISIBLE_NO_REPLY_NOTICE,
    );
    expect(screen.getByTestId("caring-contacts-template-detail-automated-reply")).toHaveTextContent(
      AUTOMATED_REPLY_RESPONSE,
    );
  });

  it("carries neither sentence the owner's copy decisions replaced on 2026-08-24", () => {
    renderVersion();

    // The positive control is the block above: both current strings are on screen, so these
    // absences are asserted over a render that really produced the reply-handling section.
    expect(screen.getByTestId("caring-contacts-template-detail-no-reply-notice")).toBeInTheDocument();
    expect(bodyText(), "the superseded no-reply notice is on screen").not.toContain(SUPERSEDED_NO_REPLY_NOTICE);
    expect(bodyText(), "the superseded storage claim is on screen").not.toContain(SUPERSEDED_REPLY_STORAGE_CLAIM);
  });

  it("does not claim anything is currently sent from this workspace", () => {
    renderVersion();

    expect(bodyText()).toContain("No sender is connected to this workspace, so nothing is sent from here");
  });
});

describe("the two overlays this screen owns are offered where their words are true", () => {
  const MESSAGE_PREVIEW = WORKSPACE_OVERLAY_DEFINITIONS.find((definition) => definition.id === "message-preview");
  const TEMPLATE_CHANGED = WORKSPACE_OVERLAY_DEFINITIONS.find(
    (definition) => definition.id === "template-changed-retired",
  );

  it("reads both rows off the frozen table rather than a second copy of it", () => {
    // The premise every case below rests on. If the table ever moves either flag, these tests must
    // fail here -- naming the reason -- rather than further down where the failure would look like
    // a screen defect.
    expect(MESSAGE_PREVIEW?.mutatesState, "message-preview is no longer the non-recording row").toBe(false);
    expect(TEMPLATE_CHANGED?.mutatesState, "template-changed-retired is no longer a recording row").toBe(true);
  });

  it("offers the message preview as an EXIT on a version a plan may be started on", async () => {
    renderDetail({ kind: "version", version: version() });
    render(<WorkspaceOverlays />);

    const trigger = screen.getByRole("button", { name: "Open message preview" });
    expect(trigger).toHaveAttribute("data-overlay-trigger", "message-preview");
    // The exit-only route, not a no-op commit: a `record: () => {}` would tell the host this
    // decision is wired and record nothing, which is the defect Ruling 87 exists to prevent in the
    // one shape the type system cannot see through.
    expect(trigger).toHaveAttribute("data-overlay-trigger-kind", "exit-only");

    await userEvent.click(trigger);

    const action = await screen.findByTestId("workspace-overlay-action");
    // Ruling 90: the control on a row that records nothing is an exit, and refusing it renders a
    // sentence that is false about a control whose whole action is to leave.
    expect(action, "the preview's way out was refused").not.toHaveAttribute("aria-disabled");
    expect(action).not.toHaveAttribute("disabled");
  });

  it("does not offer a preview of wording a record does not hold", () => {
    renderDetail({
      kind: "version",
      version: version({
        snapshot: snapshot({
          messageTextByType: Object.freeze({ standard: "", first: "", closing: "" }) as Readonly<
            Record<MessageType, string>
          >,
        }),
      }),
    });

    // Positive control: this IS the branch that offers the preview when there is wording, so the
    // absence is about the wording rather than about the lifecycle.
    expect(screen.getByText("Starting a plan on this version")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open message preview" })).toBeNull();
    expect(screen.getByText("There is no wording to preview: this record holds none.")).toBeInTheDocument();
  });

  it("offers the lifecycle overlay on a RETIRED version, and states in its own words what it cannot do", async () => {
    renderDetail({ kind: "version", version: version({ state: "retired" }) });
    render(<WorkspaceOverlays />);

    const trigger = screen.getByRole("button", { name: "Review the lifecycle decision" });
    expect(trigger).toHaveAttribute("data-overlay-trigger", "template-changed-retired");

    await userEvent.click(trigger);

    const action = await screen.findByTestId("workspace-overlay-action");
    // A recording row whose decision no control in this workspace performs. The overlay opens and
    // states the reason; the action is inert but still focusable, and never both `disabled` and
    // `aria-disabled`, which lint fails on as a pair.
    expect(action).toHaveAttribute("aria-disabled", "true");
    expect(action).not.toHaveAttribute("disabled");
    const describedBy = action.getAttribute("aria-describedby");
    expect(describedBy, "the refused decision points at no reason").not.toBeNull();
    expect(document.getElementById(describedBy!)?.textContent).toContain(
      "Nothing in this workspace moves a plan onto a different version",
    );
  });

  it("does not raise the retirement overlay over a version that has never been retired", () => {
    renderDetail({ kind: "version", version: version({ state: "inReview", approvals: [] }) });

    // Its frozen summary says the template "was retired after this draft was opened", which is a
    // false sentence over a version nobody has approved, let alone retired. The approved mockup
    // offers it for everything that is not current; this is the one place this screen departs from
    // it, and the departure is the truthfulness of the sentence.
    expect(screen.getByRole("note", { name: "Not yet available for a new plan" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Review the lifecycle decision" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open message preview" })).toBeNull();
  });
});

describe("a record this screen cannot show says WHICH fact that is", () => {
  it("separates a role that may not read one from a version this team does not hold", () => {
    const { unmount } = renderDetail({ kind: "not-permitted" });
    const notPermitted = screen.getByRole("group", { name: "Governed versions are not visible in this role" });
    expect(notPermitted).toBeInTheDocument();
    const notPermittedBody = bodyOfEmptyState(notPermitted);
    unmount();

    renderDetail({ kind: "not-held", pathwayId: "SYN-PATHWAY-404" });
    const notHeld = screen.getByRole("group", { name: "No governed version with this identifier" });
    const notHeldBody = bodyOfEmptyState(notHeld);

    // Held apart by their own words, not merely by their headings: two states that render the same
    // paragraph are one state with two names. The HEADINGS are excluded (see `bodyOfEmptyState`),
    // because including them is what made this comparison unfalsifiable in round 1.
    expect(notPermittedBody.length, "the not-permitted state rendered no body text").toBeGreaterThan(0);
    expect(notHeldBody.length, "the not-held state rendered no body text").toBeGreaterThan(0);
    expect(notHeldBody).not.toBe(notPermittedBody);
    expect(notPermittedBody).toContain("not part of the role you are acting in");
    expect(notHeldBody).toContain("looks exactly the same here");
  });

  it("never echoes the identifier from the address back onto the screen", () => {
    // Ruling [111]'s neighbour: the segment is attacker-controlled text, and a governance screen
    // that printed it back would be a reflection surface on a route reachable by link.
    renderDetail({ kind: "not-held", pathwayId: "SYN-PATHWAY-REFLECTED" });

    expect(screen.getByRole("group", { name: "No governed version with this identifier" })).toBeInTheDocument();
    expect(bodyText()).not.toContain("SYN-PATHWAY-REFLECTED");
  });

  it("offers a way back to the library from every one of the three views", () => {
    for (const view of [
      { kind: "not-permitted" } as const,
      { kind: "not-held", pathwayId: "SYN-PATHWAY-404" } as const,
      { kind: "version", version: version() } as const,
    ]) {
      const { unmount } = renderDetail(view);
      const back = screen.getAllByRole("link", { name: /governed version/i });
      expect(back.length, `${view.kind} offers no way back`).toBeGreaterThan(0);
      for (const link of back) {
        expect(link.getAttribute("href")).toBe(CARING_CONTACTS_ROUTES.templates);
      }
      unmount();
    }
  });
});

describe("the template detail navigates and sizes the way this workspace requires", () => {
  it("uses Link for every internal destination, and no raw anchor to an internal route", () => {
    const { container } = renderVersion();
    const anchors = [...container.querySelectorAll("a[href^='/']")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) {
      expect(anchor.getAttribute("data-internal-link")).toBe("true");
      expect(anchor.getAttribute("href")?.startsWith(CARING_CONTACTS_ROUTES.templates)).toBe(true);
    }
  });

  it("puts the tap-target minimum on every control, never min-h-11", () => {
    const { container } = renderDetail({ kind: "version", version: version({ state: "retired" }) });
    const controls = [...container.querySelectorAll("a[href^='/'], button")];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.getAttribute("class") ?? "", `${control.textContent} is not a tap target`).toContain("min-h-tap");
      expect(control.getAttribute("class") ?? "").not.toContain("min-h-11");
    }
  });

  /**
   * A STATIC PROXY FOR TWO BROWSER PROOFS, LABELLED AS ONE.
   *
   * Forced-colors and a 320px viewport are browser facts and these are not browser assertions: they
   * read the class list of a jsdom render, where no media query and no forced-colors mode is ever
   * evaluated. They catch the two regressions that are mechanically visible in the markup and prove
   * nothing about how any of it paints. The browser half is the `caring-contacts template detail`
   * block in `tests/ui-caring-contacts-workspace.spec.ts`, which has not been run.
   *
   * ONE SCENARIO LIST FOR BOTH, each carrying its OWN positive control naming the surface it exists
   * to put on screen. A fixture that renders none of the surface under test passes while examining
   * nothing, which is exactly how the templates library's first version of this check stayed green
   * through a mutation that stripped the fallback it was written for.
   */
  const surfaceScenarios: readonly {
    name: string;
    open: () => ReturnType<typeof renderDetail>;
    present: (container: HTMLElement) => void;
  }[] = [
    {
      name: "a current version with its wording and its preview control",
      open: () => renderDetail({ kind: "version", version: version({ snapshot: snapshot() }) }),
      present: (container) => {
        expect(
          within(container).getByTestId("caring-contacts-template-detail-wording-standard"),
          "no wording quotation rendered",
        ).toBeInTheDocument();
        expect(within(container).getByRole("button", { name: "Open message preview" })).toBeInTheDocument();
      },
    },
    {
      name: "a retired version with its lifecycle notice",
      open: () => renderDetail({ kind: "version", version: version({ state: "retired" }) }),
      present: (container) => {
        expect(within(container).getByRole("note", { name: "Not available for a new plan" })).toBeInTheDocument();
        expect(within(container).getByRole("button", { name: "Review the lifecycle decision" })).toBeInTheDocument();
      },
    },
    {
      name: "a version this team does not hold",
      open: () => renderDetail({ kind: "not-held", pathwayId: "SYN-PATHWAY-404" }),
      present: (container) => {
        expect(
          within(container).getByRole("group", { name: "No governed version with this identifier" }),
        ).toBeInTheDocument();
      },
    },
  ];

  it("gives every bordered surface a forced-colors fallback, so none of them vanishes", () => {
    for (const { name, open, present } of surfaceScenarios) {
      const { container, unmount } = open();
      present(container);

      // EVERY border token, not one of them. Fix round 1, NIT 7: this selected only
      // `border-[color:var(--border)]`, so a surface drawn with `--border-strong` (or any other
      // token) matched neither the selector nor the check and was silently not examined -- a hole
      // that opens with no red the first time such a surface is added. The prefix is the part
      // every border token shares.
      const bordered = [...container.querySelectorAll("[class*='border-[color:var(--']")];
      expect(bordered.length, `${name} draws no border — the check would be vacuous`).toBeGreaterThan(0);
      for (const element of bordered) {
        // `getAttribute("class")`, not `.className`: on an SVG element the latter is an
        // `SVGAnimatedString` object rather than a string.
        //
        // Two spellings are accepted and both are real fallbacks. This screen's own surfaces use
        // `forced-colors:border-[CanvasText]`, which restates the colour in a system keyword; the
        // shared overlay trigger uses the bare `forced-colors:border`, which restates the STYLE so
        // the control keeps an edge when the tokens are replaced. What this check refuses is a
        // bordered surface carrying neither.
        expect(
          element.getAttribute("class") ?? "",
          `${name}: ${element.tagName} draws a border with no forced-colors fallback`,
        ).toMatch(/forced-colors:border/);
      }
      unmount();
    }
  });

  it("sets no fixed pixel width anywhere, so 320px has nothing to overflow", () => {
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
