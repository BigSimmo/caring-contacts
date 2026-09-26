// tests/caring-contacts-team-roster.dom.test.tsx
//
// Phase 2B Task 18 -- the Team screen's body: the desktop ownership table, the mobile roster, the
// unclaimed indicator, and the "Reassign work" control.
//
// WHAT THIS FILE IS ABOUT, and it is mostly refusals rather than features. Three columns the
// approved design draws cannot be produced from anything this system holds -- a staff display name,
// a role for anybody but the acting user, and a per-member unclaimed count -- and Task 17 measured
// each one rather than guessing. So most of what is asserted here is that the screen states what it
// does not hold instead of filling the gap: an identifier is rendered as an identifier, an age is
// named for what it measures, and the unclaimed figures are attached to the group that has no owner
// rather than shared out between people who do not own them.
//
// EVERY ABSENCE BELOW HAS A POSITIVE CONTROL. The standing discipline's rule, applied literally: an
// absence asserted over a view that never carried the value is decoration. So each case sets the
// value in its own fixture, asserts the screen holds it where it belongs, and only then asserts it
// is missing from where it must not be.
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TeamRoster } from "@/components/caring-contacts/workspace/team-roster";
import { CARING_CONTACTS_ROUTES } from "@/lib/caring-contacts-routes";
import { actorId } from "@/lib/caring-contacts/ids";
import type { CoordinatorWorkload, TeamWorkloadView, UnclaimedWork } from "@/lib/caring-contacts/team-workload";

const AS_AT = "2026-08-30T11:00:00+08:00";
const THRESHOLD = 60;

function coordinator(id: string, overrides: Partial<CoordinatorWorkload> = {}): CoordinatorWorkload {
  return {
    actorId: actorId(id),
    activePlans: 0,
    heldPlans: [],
    coveredByAnother: 0,
    coveringForAnother: 0,
    exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
    ...overrides,
  };
}

function noUnclaimed(): UnclaimedWork {
  return {
    plans: 0,
    activePlans: 0,
    escalated: 0,
    oldestMinutesUnclaimed: null,
    state: "noUnclaimedWork",
    clearedBy: null,
    exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
  };
}

function view(overrides: Partial<TeamWorkloadView> = {}): TeamWorkloadView {
  return {
    asAtIso: AS_AT,
    coordinators: [],
    unclaimed: noUnclaimed(),
    thresholdMinutes: THRESHOLD,
    ...overrides,
  };
}

function renderRoster(
  overrides: Partial<TeamWorkloadView> = {},
  capabilities: { mayViewPlans?: boolean; mayReassignPlan?: boolean } = {},
) {
  return render(
    <TeamRoster
      view={view(overrides)}
      mayViewPlans={capabilities.mayViewPlans ?? true}
      mayReassignPlan={capabilities.mayReassignPlan ?? true}
    />,
  );
}

/** The desktop ownership table. Scoped, because the mobile roster renders the same figures. */
function table(): HTMLElement {
  return screen.getByTestId("caring-contacts-team-table");
}

/** The compact roster. */
function roster(): HTMLElement {
  return screen.getByTestId("caring-contacts-team-roster");
}

function textOf(element: HTMLElement): string {
  return (element.textContent ?? "").toLowerCase();
}

describe("the Team screen never ranks a clinician (spec 4.2)", () => {
  /**
   * The fixture's work order is the exact reverse of its identifier order, so a screen that sorted
   * by the counts could not pass this by coincidence. It is the same shape the domain's own order
   * case uses, applied one layer up: the domain proves the order it PRODUCES, and this proves the
   * screen renders that order rather than one of its own.
   */
  const disagreeingOrder = {
    coordinators: [
      coordinator("ACTOR-AVA", { activePlans: 1 }),
      coordinator("ACTOR-BLAKE", { activePlans: 2 }),
      coordinator("ACTOR-CASS", { activePlans: 3 }),
    ],
  };

  it("renders the rows in the order the read gave them, not in order of how much work each carries", () => {
    renderRoster(disagreeingOrder);

    const rows = within(table()).getAllByTestId("caring-contacts-team-row");
    expect(rows.map((row) => within(row).getByTestId("caring-contacts-team-actor").textContent)).toEqual([
      "ACTOR-AVA",
      "ACTOR-BLAKE",
      "ACTOR-CASS",
    ]);
    // The positive control for the assertion above: the counts really are on the screen and really
    // do disagree with the order. Without this, three rows in identifier order would satisfy the
    // expectation even if no count had been rendered at all.
    expect(rows.map((row) => within(row).getByTestId("caring-contacts-team-active").textContent)).toEqual([
      "1",
      "2",
      "3",
    ]);
  });

  it("says on the screen that the order is not a placing", () => {
    renderRoster(disagreeingOrder);
    expect(textOf(screen.getByTestId("caring-contacts-team"))).toContain("identifier order");
  });

  it("carries no ranking vocabulary anywhere on the screen", () => {
    renderRoster(disagreeingOrder);
    const text = textOf(screen.getByTestId("caring-contacts-team"));
    for (const word of ["rank", "percentile", "score", "leaderboard", "busiest", "quietest", "performance"]) {
      expect(text, `the screen uses the word "${word}"`).not.toContain(word);
    }
  });
});

describe("the roster renders an identifier as an identifier, because no staff name is held", () => {
  it("renders the actor id verbatim and says plainly that a name is not held", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 2 })] });

    expect(within(table()).getByTestId("caring-contacts-team-actor")).toHaveTextContent("ACTOR-AVA");
    expect(textOf(screen.getByTestId("caring-contacts-team"))).toContain("no name for a member of staff");
  });

  it("leaves a demo actor id whose text contains a role name as an identifier, never as role wording", () => {
    // The demo role switcher mints ids shaped `demo-<role>`, so this exact string is reachable.
    // Rendering it as words would be a claim about someone's authority invented by a screen, and it
    // would also walk through the interface-vocabulary scan's known word-boundary hole. The
    // identifier travels; nothing is resolved from it.
    renderRoster({ coordinators: [coordinator("demo-clinicalProgrammeLead", { activePlans: 1 })] });

    const actor = within(table()).getByTestId("caring-contacts-team-actor");
    expect(actor).toHaveTextContent("demo-clinicalProgrammeLead");
    // The positive control is the assertion above: the string IS on the screen, so the absence
    // below is about the FORM it took rather than about the value being missing.
    expect(textOf(screen.getByTestId("caring-contacts-team"))).not.toContain("clinical programme lead");
  });

  it("has no Role column at all, because nothing returns the roles an actor id holds", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] });

    const headers = within(table())
      .getAllByRole("columnheader")
      .map((header) => (header.textContent ?? "").toLowerCase());
    expect(headers.length).toBeGreaterThan(0);
    expect(headers).not.toContain("role");
  });
});

describe("unclaimed work belongs to the group with no owner, never to a person", () => {
  const escalatedUnclaimed: UnclaimedWork = {
    plans: 3,
    activePlans: 0,
    escalated: 2,
    oldestMinutesUnclaimed: 145,
    state: "escalated",
    clearedBy: "aCoordinatorClaimsThePlan",
    exceptionBacklog: { contacts: 4, oldestMinutesSinceScheduledSend: 90 },
  };

  it("states the unclaimed figures once, in the unclaimed block, and in no coordinator's row", () => {
    renderRoster({
      coordinators: [coordinator("ACTOR-AVA", { activePlans: 7 })],
      unclaimed: escalatedUnclaimed,
    });

    // The positive control: the figures ARE rendered, so the absence below is about where.
    const unclaimed = screen.getByTestId("caring-contacts-team-unclaimed");
    expect(unclaimed).toHaveTextContent("3");
    expect(textOf(unclaimed)).toContain("unclaimed");

    for (const row of within(table()).getAllByTestId("caring-contacts-team-row")) {
      expect(textOf(row), "a coordinator row carries an unclaimed figure").not.toContain("unclaim");
    }
    for (const entry of within(roster()).getAllByTestId("caring-contacts-team-roster-entry")) {
      expect(textOf(entry), "a roster entry carries an unclaimed figure").not.toContain("unclaim");
    }
  });

  it("counts contacts needing review on unowned plans, so none goes uncounted for want of an owner", () => {
    renderRoster({ unclaimed: escalatedUnclaimed });

    expect(textOf(screen.getByTestId("caring-contacts-team-unclaimed"))).toContain(
      "4 contacts need review on plans nobody owns",
    );
  });
});

describe("the escalation states why it happened and what would change it (spec 4.4)", () => {
  it("names the automated state, the threshold that produced it, and the one thing that clears it", () => {
    renderRoster({
      unclaimed: {
        plans: 3,
        activePlans: 0,
        escalated: 2,
        oldestMinutesUnclaimed: 145,
        state: "escalated",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
      },
    });

    const group = screen.getByRole("group", { name: /unclaimed work escalated/i });
    expect(group).toHaveTextContent("60 minutes");
    // 145 minutes is displayed as a duration ("2 hours"), not the raw minute count -- the fix this
    // suite exists to prove (design sweep, 2026-08-29). The threshold above stays a raw minute count
    // on purpose: it is a rule ("escalates at 60 minutes"), not a wait, and this screen's own words
    // for it are untouched by that fix.
    expect(group).toHaveTextContent("2 hours");
    expect(textOf(group)).toContain("a coordinator claiming the plan");
    // The reason must be IN the page, never held in a title attribute where a keyboard user reaches
    // it only by hovering.
    //
    // NO MUTATION OF THIS TASK'S FILES CAN MAKE THIS LINE FAIL, and it is said here rather than
    // implied. The group is `AutomatedState`'s own element and this screen renders no attribute
    // inside it, so the only edit that could put a `title` there is an edit to
    // `automated-state.tsx` -- which this task does not own and which
    // `tests/caring-contacts-explained-automation.dom.test.tsx` already guards. It is kept as the
    // statement that this screen's §4.4 pair is reachable without a pointer, not as proof of it.
    for (const node of group.querySelectorAll("[title]")) {
      expect(node.getAttribute("title")).not.toMatch(/escalat/i);
    }
  });

  it("does not call unclaimed work escalated while it is still inside the threshold, but still states the rule", () => {
    renderRoster({
      unclaimed: {
        plans: 1,
        activePlans: 0,
        escalated: 0,
        oldestMinutesUnclaimed: 12,
        state: "withinThreshold",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
      },
    });

    expect(screen.queryByRole("group", { name: /unclaimed work escalated/i })).toBeNull();
    const unclaimed = screen.getByTestId("caring-contacts-team-unclaimed");
    // The positive control for that absence: the block IS rendered and DOES carry the threshold and
    // the remedy, so "no escalation group" is a statement about this fixture rather than about a
    // block that failed to render.
    expect(unclaimed).toHaveTextContent("60 minutes");
    expect(textOf(unclaimed)).toContain("a coordinator claiming the plan");
    // The anchor note is rendered by a different branch here than in the escalated case above, so
    // it is asserted on both rather than on whichever one was convenient.
    expect(textOf(unclaimed)).toContain("counted from the moment the plan appeared for a coordinator to take");
  });

  it("says every running plan has a coordinator when nothing is unclaimed", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 4 })] });

    expect(textOf(screen.getByTestId("caring-contacts-team-unclaimed"))).toContain(
      "every plan that is running has a coordinator",
    );
  });

  it("does not call nothing an escalation", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 4 })] });

    expect(screen.queryByRole("group", { name: /unclaimed work escalated/i })).toBeNull();
  });

  it("renders no age in the nothing-unclaimed statement, even from a view that carries one", () => {
    // THE FIXTURE IS DELIBERATELY ONE THE DOMAIN DOES NOT PRODUCE -- `buildTeamWorkload` reports
    // `noUnclaimedWork` only with a null age. It is written this way so the absence is about the
    // BRANCH THIS SCREEN CHOSE rather than about a value that was never there to render: over an
    // honest fixture, "no age appears" is satisfied by any branch at all, which is the shape of
    // assertion the standing discipline calls decoration. With an age present in the view, a screen
    // that reached for it here would print it.
    renderRoster({
      coordinators: [coordinator("ACTOR-AVA", { activePlans: 4 })],
      unclaimed: { ...noUnclaimed(), oldestMinutesUnclaimed: 145 },
    });

    // 145 minutes renders as "2 hours" (see the escalation test above); the absence is checked
    // against that rendered form, not the raw minute count that never reaches the page.
    expect(textOf(screen.getByTestId("caring-contacts-team-unclaimed"))).not.toContain("2 hours");
  });
});

describe("both ages are named for what they measure, and neither is called a queue age", () => {
  it("calls the unclaimed figure a wait, because it now is one, and still claims no bound", () => {
    // THIS ASSERTION HAS BEEN WRONG IN TWO DIFFERENT WAYS, which is why the comment is long.
    // FIRST the screen said the true wait "is never longer than the figure shown" -- a bound it did
    // not have, because `dischargeAt` is the display convention `DISCHARGE_WALL_CLOCK_HOUR` writes
    // rather than an observed instant. That claim was retracted and the screen named its anchor
    // instead. THEN the anchor itself was replaced (2026-08-28): the read measures from the instant
    // the plan became free for a coordinator to take, so the figure IS the wait and the screen may
    // say so. The retracted bound is still refused below, because "this is the wait" and "the wait
    // is never longer than this" are different claims and only the first one is true.
    // `tests/caring-contacts-team-workload.test.ts` pins the anchoring behaviour itself, through
    // the wizard's own `dischargeInstantFor`.
    renderRoster({
      unclaimed: {
        plans: 2,
        activePlans: 0,
        escalated: 1,
        oldestMinutesUnclaimed: 145,
        state: "escalated",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
      },
    });

    const unclaimed = screen.getByTestId("caring-contacts-team-unclaimed");
    // 145 minutes renders as "2 hours", the readable duration, not the raw minute count.
    expect(unclaimed).toHaveTextContent("The oldest has been waiting 2 hours");
    const text = textOf(screen.getByTestId("caring-contacts-team"));
    // The positive control for the refusal below: the screen DOES say what the figure is, so the
    // absence is about the retracted claim rather than about a footer that failed to render.
    expect(text).toContain("how long a plan has waited for a coordinator");
    expect(text).not.toContain("never longer than the figure shown");
    // And the disclosure the old anchor forced onto the screen is gone rather than reworded: a
    // reader must not still be told the escalation can fire later than it should.
    expect(text).not.toContain("later than it should");
  });

  it("says inside the unclaimed block what the minutes are counted from, and what ends the count", () => {
    renderRoster({
      unclaimed: {
        plans: 2,
        activePlans: 0,
        escalated: 1,
        oldestMinutesUnclaimed: 145,
        state: "escalated",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 0, oldestMinutesSinceScheduledSend: null },
      },
    });

    const unclaimed = textOf(screen.getByTestId("caring-contacts-team-unclaimed"));
    expect(unclaimed).toContain("counted from the moment the plan appeared for a coordinator to take");
    expect(unclaimed).toContain("stays in this count until somebody claims it");
  });

  it("names the backlog age as time since the scheduled send", () => {
    renderRoster({
      coordinators: [
        coordinator("ACTOR-AVA", {
          activePlans: 2,
          exceptionBacklog: { contacts: 3, oldestMinutesSinceScheduledSend: 45 },
        }),
      ],
    });

    const cell = within(within(table()).getByTestId("caring-contacts-team-row")).getByTestId(
      "caring-contacts-team-backlog",
    );
    expect(cell).toHaveTextContent("3");
    expect(cell).toHaveTextContent("45 minutes since its scheduled send");
  });

  it("uses neither of the two names that would claim a precision the read does not hold", () => {
    renderRoster({
      coordinators: [
        coordinator("ACTOR-AVA", {
          activePlans: 2,
          exceptionBacklog: { contacts: 3, oldestMinutesSinceScheduledSend: 45 },
        }),
      ],
      unclaimed: {
        plans: 2,
        activePlans: 0,
        escalated: 1,
        oldestMinutesUnclaimed: 145,
        state: "escalated",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 1, oldestMinutesSinceScheduledSend: 30 },
      },
    });

    // The positive control: both ages are on the screen, so these absences are about the WORDS.
    // 145 minutes (the unclaimed age) renders as "2 hours"; 45 minutes (the backlog age) stays under
    // an hour and so is still exact minutes -- both are the readable-duration fix, at two different
    // points on the same scale.
    const text = textOf(screen.getByTestId("caring-contacts-team"));
    expect(text).toContain("the oldest has been waiting 2 hours");
    expect(text).toContain("45 minutes since its scheduled send");
    expect(text).not.toContain("queue age");
    expect(text).not.toContain("waiting time");
  });

  it("renders an empty backlog as none rather than as a count of zero with an age", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 2 })] });

    const cell = within(within(table()).getByTestId("caring-contacts-team-row")).getByTestId(
      "caring-contacts-team-backlog",
    );
    expect(cell).toHaveTextContent("None");
    expect(textOf(cell)).not.toContain("minutes");
  });
});

describe("the roster states what a plan's own state is doing to it, and who is covering", () => {
  it("names each hold in plain words, and omits a hold no plan is in", () => {
    renderRoster({
      coordinators: [
        coordinator("ACTOR-AVA", {
          activePlans: 1,
          heldPlans: [{ hold: "planPaused", plans: 2 }],
        }),
      ],
    });

    const cell = within(within(table()).getByTestId("caring-contacts-team-row")).getByTestId(
      "caring-contacts-team-held",
    );
    expect(cell).toHaveTextContent("Plan paused");
    expect(cell).toHaveTextContent("2");
    expect(textOf(cell)).not.toContain("plan not started");
  });

  it("states coverage in both directions, and keeps the named owner's own count visible behind it", () => {
    renderRoster({
      coordinators: [
        coordinator("ACTOR-AVA", { activePlans: 5, coveredByAnother: 2 }),
        coordinator("ACTOR-BLAKE", { activePlans: 1, coveringForAnother: 2 }),
      ],
    });

    const [ava, blake] = within(table()).getAllByTestId("caring-contacts-team-row");
    expect(within(ava).getByTestId("caring-contacts-team-coverage")).toHaveTextContent(
      "2 plans are being covered by someone else",
    );
    // Coverage never moves ownership, so the owner's own count is unchanged by it.
    expect(within(ava).getByTestId("caring-contacts-team-active")).toHaveTextContent("5");
    expect(within(blake).getByTestId("caring-contacts-team-coverage")).toHaveTextContent(
      "Covering 2 plans for someone else",
    );
  });

  it("says none rather than zero when nobody is covering anything", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] });

    expect(
      within(within(table()).getByTestId("caring-contacts-team-row")).getByTestId("caring-contacts-team-coverage"),
    ).toHaveTextContent("None");
  });
});

describe("a covered plan's backlog is filed under its owner, and the screen says so", () => {
  /**
   * THE FACT THIS PINS IS UNPLEASANT AND THAT IS WHY IT IS STATED. `buildTeamWorkload` pushes a
   * plan's reviewable contacts onto its NAMED OWNER's tally and onto nobody else's, so while a
   * coordinator is away the exception backlog sits against the person who is not answering and the
   * person covering reads as carrying none. `tests/caring-contacts-team-workload.test.ts` pins the
   * attribution itself; this pins that a reader is told how to read the column.
   *
   * It also carries the second half of the same fact: a coordinator who owns nothing and is only
   * covering shows `Plans sending: 0`, which is true and understates what they are holding.
   */
  const covering = {
    coordinators: [
      coordinator("ACTOR-AVA", {
        activePlans: 2,
        coveredByAnother: 2,
        exceptionBacklog: { contacts: 3, oldestMinutesSinceScheduledSend: 90 },
      }),
      coordinator("ACTOR-BLAKE", { coveringForAnother: 2 }),
    ],
  };

  it("says where a covered plan's contacts needing review are counted, and how to read a covering row", () => {
    renderRoster(covering);

    // The positive control: the two figures the sentences are about are really on the screen, so
    // neither sentence is an explanation of something the reader cannot see.
    const rows = within(table()).getAllByTestId("caring-contacts-team-row");
    expect(within(rows[0]).getByTestId("caring-contacts-team-backlog")).toHaveTextContent("3 contacts");
    expect(within(rows[1]).getByTestId("caring-contacts-team-active")).toHaveTextContent("0");

    const text = textOf(screen.getByTestId("caring-contacts-team"));
    expect(text).toContain("stay counted against the coordinator who owns it");
    expect(text).toContain("shows no plans of their own");
  });

  it("does not explain coverage on a roster where nobody is covering anything", () => {
    // The positive control is the case above: with coverage present the sentence renders, so this
    // absence is about the condition rather than about a sentence that was never written.
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 2 })] });

    expect(textOf(screen.getByTestId("caring-contacts-team"))).not.toContain(
      "stay counted against the coordinator who owns it",
    );
  });
});

describe("the screen says when it was measured in words, not as a machine timestamp", () => {
  /**
   * The Schedule screen's convention, applied here: weekday and month names written out rather than
   * formatted by `Intl`, whose output depends on the ICU data the runtime was built with. This
   * screen was rendering `2026-08-30T11:00:00+08:00` as body text -- the only machine timestamp
   * anywhere in the workspace.
   */
  it("renders the measurement time in plain words", () => {
    const { container } = renderRoster({});

    const stamp = container.querySelector("time");
    expect(stamp).not.toBeNull();
    expect(stamp).toHaveTextContent("11:00 am AWST on Sunday 30 August 2026");
  });

  /**
   * SPLIT FROM THE CASE ABOVE DELIBERATELY. Held together, a screen that printed the ISO string as
   * its text would fail the plain-words assertion FIRST and the refusal below would never be
   * evaluated -- an assertion behind a sibling that fails first is never reached, so it would have
   * been unproven however red the case went.
   */
  it("keeps the machine value on the attribute and out of the words a clinician reads", () => {
    const { container } = renderRoster({});

    // The positive control: the ISO value IS in this document, on the attribute where a machine
    // reads it, so the refusal below is about WHERE it appears and not about a value nothing held.
    expect(container.querySelector("time")).toHaveAttribute("dateTime", AS_AT);
    expect(textOf(screen.getByTestId("caring-contacts-team"))).not.toContain(AS_AT.toLowerCase());
  });
});

describe("the mobile roster carries the same figures the table does", () => {
  it("renders one entry per coordinator, in the same order, with the same active count", () => {
    renderRoster({
      coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 }), coordinator("ACTOR-BLAKE", { activePlans: 2 })],
    });

    const entries = within(roster()).getAllByTestId("caring-contacts-team-roster-entry");
    expect(entries.map((entry) => within(entry).getByTestId("caring-contacts-team-actor").textContent)).toEqual([
      "ACTOR-AVA",
      "ACTOR-BLAKE",
    ]);
    expect(entries.map((entry) => within(entry).getByTestId("caring-contacts-team-active").textContent)).toEqual([
      "1",
      "2",
    ]);
  });
});

describe("an empty roster says which fact it is", () => {
  it("says nobody is carrying work when the reader may see plans and there is none", () => {
    renderRoster({});

    expect(screen.getByRole("group", { name: /nobody is carrying work/i })).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-team-table")).toBeNull();
  });

  it("never claims the team is idle to a role that may not see plans at all", () => {
    // `listPlans` answers a role without the capability with `[]`, exactly as it answers a team
    // carrying nothing. A screen that only counted rows would tell an auditor their team has no
    // work, which is a false statement about a clinical service.
    renderRoster({}, { mayViewPlans: false });

    expect(screen.getByRole("group", { name: /not visible in this role/i })).toBeInTheDocument();
    expect(screen.queryByText(/nobody is carrying work/i)).toBeNull();
  });
});

describe("the Reassign work control", () => {
  it("is a real link to the caseload, and says in place why reassignment starts there", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] });

    const control = screen.getByTestId("caring-contacts-team-reassign");
    expect(control.tagName).toBe("A");
    expect(control).toHaveAttribute("href", CARING_CONTACTS_ROUTES.patients);
    expect(control).toHaveAttribute("data-internal-link", "true");

    const noteId = control.getAttribute("aria-describedby");
    expect(noteId, "the control states no reason").toBeTruthy();
    const note = document.getElementById(noteId!);
    expect(note).not.toBeNull();
    expect(textOf(note as HTMLElement)).toContain("reassignment is done on one plan");
  });

  it("meets the production tap target on the element that contains the control", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] });

    const control = screen.getByTestId("caring-contacts-team-reassign");
    const classes = control.getAttribute("class") ?? "";
    expect(classes).toContain("min-h-tap");
    expect(classes).not.toContain("min-h-11");
  });

  it("offers no control at all to a role that may not move a plan, and says so", () => {
    renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] }, { mayReassignPlan: false });

    // The positive control: with the capability the control is present (asserted above), so this
    // absence is about the capability rather than about a control that never renders.
    expect(screen.queryByTestId("caring-contacts-team-reassign")).toBeNull();
    expect(textOf(screen.getByTestId("caring-contacts-team"))).toContain(
      "moving a plan to another coordinator is not available in this role",
    );
  });

  it("navigates with a Link rather than a raw anchor to an internal route", () => {
    const { container } = renderRoster({ coordinators: [coordinator("ACTOR-AVA", { activePlans: 1 })] });

    const anchors = [...container.querySelectorAll("a[href^='/']")];
    expect(anchors.length).toBeGreaterThan(0);
    for (const anchor of anchors) expect(anchor.getAttribute("data-internal-link")).toBe("true");
  });
});

describe("the screen carries nothing about a patient", () => {
  it("renders no patient, plan or contact identifier, because the read holds none to render", () => {
    // The view type carries no such field, so this is a pin on the SHAPE the screen is handed
    // rather than on a narrowing the screen performs -- said here rather than implied, because the
    // standing discipline forbids labelling an assertion without checking what it reads.
    renderRoster({
      coordinators: [
        coordinator("ACTOR-AVA", {
          activePlans: 2,
          exceptionBacklog: { contacts: 1, oldestMinutesSinceScheduledSend: 10 },
        }),
      ],
      unclaimed: {
        plans: 1,
        activePlans: 0,
        escalated: 1,
        oldestMinutesUnclaimed: 200,
        state: "escalated",
        clearedBy: "aCoordinatorClaimsThePlan",
        exceptionBacklog: { contacts: 2, oldestMinutesSinceScheduledSend: 15 },
      },
    });

    const text = textOf(screen.getByTestId("caring-contacts-team"));
    expect(text).toContain("actor-ava");
    for (const shape of ["syn-patient", "syn-plan", "syn-contact"]) {
      expect(text).not.toContain(shape);
    }
  });
});
