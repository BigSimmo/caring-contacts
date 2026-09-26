// tests/caring-contacts-reporting.test.ts
//
// Phase 2B Task 19. The two domain modules behind `/caring-contacts/reports`:
// `reach-reporting.ts` (spec §2.5's small-cell suppression) and `operational-reporting.ts`.
//
// THE FILE'S CENTRE IS THE INFERENCE ATTEMPT, and everything else is around it.
//
// `Suppressed` has to be NON-INFERABLE, and the way most implementations of it fail is arithmetic
// rather than logic: suppress every cell below the threshold, publish the rest and the total, and a
// single suppressed cell is the total minus the cells that were published. So the test below does
// not check that the word "Suppressed" appears. It takes the disclosure a reader would be given,
// enumerates every assignment of numbers to the hidden cells consistent with it, and asks whether
// any hidden cell has exactly one feasible value.
//
// AND IT CARRIES ITS OWN POSITIVE CONTROL. The same attack is run against a NAIVE suppression
// computed here in the test -- the implementation the module exists to be better than -- and is
// required to succeed there. An attack that could not recover a cell from naive suppression would
// prove nothing by failing to recover one from the real thing, and that is the whole shape of an
// absence asserted where no reachable state could make it fail.
import { describe, expect, it } from "vitest";

import { awstCalendarDay } from "@/lib/caring-contacts/clock";
import { contactId, patientId, pathwayVersionId, planId, referralId, teamId } from "@/lib/caring-contacts/ids";
import type { ContactState, MessageType, PlanState } from "@/lib/caring-contacts/model";
import {
  summariseDispatchDiscrepancies,
  summariseOperationalReport,
} from "@/lib/caring-contacts/operational-reporting";
import {
  MINIMUM_SUPPRESSING_THRESHOLD,
  discloseReach,
  reachReportingThreshold,
  type ReachCell,
  type ReachDisclosure,
} from "@/lib/caring-contacts/reach-reporting";
import { REACH_REPORTING_GOVERNANCE } from "@/lib/caring-contacts/reach-reporting-governance";
import type { DispatchRecord, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";

import { naiveSuppression, recoverableCategories, type ReadableCell } from "./helpers/caring-contacts-reach-inference";

/**
 * The disclosure as a reader would see it -- built exactly as the reach section builds its rows
 * from the same value, so the attack below runs against what would be on the page rather than
 * against the module's internals.
 */
function asReadable(disclosure: ReachDisclosure): ReadableCell[] {
  if (disclosure.kind === "withheld") return [];
  return disclosure.cells.map((cell) =>
    cell.disclosed ? { category: cell.category, count: cell.count } : { category: cell.category, count: "hidden" },
  );
}

// ---------------------------------------------------------------------------
// The inference attempt
// ---------------------------------------------------------------------------

/**
 * The threshold these arithmetic cases are computed at.
 *
 * A FIXTURE, not the governance value, and it is worth saying so because they currently coincide:
 * the owner's decision is also 5. Nothing below depends on that -- the suppression cases are about
 * the arithmetic at a given threshold, and the governance block further down is the only place the
 * decided value is asserted. If the decision moves, these cases must not.
 */
const THRESHOLD = 5;
/** One small cell among larger ones -- the shape naive suppression gives away in one subtraction. */
const ONE_SMALL_CELL: readonly ReachCell[] = [
  { category: "Aboriginal", count: 12 },
  { category: "Torres Strait Islander", count: 2 },
  { category: "Neither", count: 9 },
];
const ONE_SMALL_CELL_TOTAL = 23;

describe("caring-contacts reach reporting -- the inference attempt", () => {
  it("recovers a hidden cell from NAIVE suppression, which is what makes the attack a real one", () => {
    const readable = naiveSuppression(ONE_SMALL_CELL, THRESHOLD);

    // The positive control. If this ever stops recovering the cell, every "cannot be recovered"
    // assertion below has quietly become an assertion about nothing.
    expect(recoverableCategories(readable, ONE_SMALL_CELL_TOTAL)).toEqual(["Torres Strait Islander"]);
  });

  it("recovers nothing from the real disclosure of the same data", () => {
    const readable = asReadable(discloseReach(ONE_SMALL_CELL, THRESHOLD));

    expect(readable, "the disclosure was withheld, so this case proves nothing about suppression").not.toEqual([]);
    expect(recoverableCategories(readable, ONE_SMALL_CELL_TOTAL)).toEqual([]);
  });

  it("hides a second cell to do it, rather than hiding the same one harder", () => {
    const readable = asReadable(discloseReach(ONE_SMALL_CELL, THRESHOLD));
    const hidden = readable.filter((cell) => cell.count === "hidden").map((cell) => cell.category);

    // The mechanism, asserted separately from its effect: one hidden cell is always recoverable,
    // so the disclosure has to hide a cell it was under no obligation to hide. It takes the
    // smallest, which costs the least information a promotion can.
    expect(hidden).toEqual(["Torres Strait Islander", "Neither"]);
  });

  it("recovers nothing when EVERY cell is small, which naive suppression would leave inert", () => {
    const cells: readonly ReachCell[] = [
      { category: "Aboriginal", count: 3 },
      { category: "Torres Strait Islander", count: 1 },
      { category: "Both", count: 2 },
    ];
    const disclosure = discloseReach(cells, 6);

    // Every cell is below the threshold, so all three are hidden and there is no published cell to
    // subtract. Three numbers summing to six admit many splits.
    expect(asReadable(disclosure).every((cell) => cell.count === "hidden")).toBe(true);
    expect(recoverableCategories(asReadable(disclosure), 6)).toEqual([]);
  });

  it("withholds the breakdown whole when hiding everything would still give a number away", () => {
    // Every category empty: however many cells are hidden, each is pinned at zero, and no
    // promotion can change that because there is nothing left to promote. Published, it would say
    // "no patient is in any of these categories" -- a statement, made from suppressed cells.
    expect(
      discloseReach(
        [
          { category: "Aboriginal", count: 0 },
          { category: "Neither", count: 0 },
        ],
        THRESHOLD,
      ),
    ).toEqual({ kind: "withheld", reason: "no-safe-disclosure" });
  });

  it("withholds a single-category breakdown of a small cell, having nothing to promote", () => {
    expect(discloseReach([{ category: "Aboriginal", count: 2 }], THRESHOLD)).toEqual({
      kind: "withheld",
      reason: "no-safe-disclosure",
    });
  });

  it("publishes every cell untouched when none of them is small", () => {
    const cells: readonly ReachCell[] = [
      { category: "Aboriginal", count: 12 },
      { category: "Neither", count: 9 },
    ];

    expect(discloseReach(cells, THRESHOLD)).toEqual({
      kind: "breakdown",
      cells: [
        { category: "Aboriginal", disclosed: true, count: 12 },
        { category: "Neither", disclosed: true, count: 9 },
      ],
    });
  });
});

describe("caring-contacts reach reporting -- the threshold is an input, never a literal", () => {
  it("reads the owner's decision rather than a number chosen in the module that uses it", () => {
    // The threshold is a DISCLOSURE CONTROL, so where it comes from is part of what it is. This
    // pins the lookup to the governance record rather than to the value, which is what makes a
    // literal reintroduced into `reach-reporting.ts` a failure rather than a coincidence.
    expect(reachReportingThreshold()).toBe(REACH_REPORTING_GOVERNANCE.smallCellThreshold);
    expect(reachReportingThreshold()).not.toBeNull();
  });

  it("pins the decided value TOGETHER with what it rests on, so neither can move without the other", () => {
    // THIS PIN IS THE ONLY THING THAT MAKES A CHANGE TO THE THRESHOLD DELIBERATE. There is no
    // migration, no review gate and no second approver behind it today: an edit to the number alone
    // would otherwise be a one-character change to a disclosure control. Pinning the provenance
    // beside the value means an edit that moves one and not the other goes red, so the record and
    // the number cannot drift apart. Do not relax this to make an edit easier -- see the note in
    // `reach-reporting-governance.ts`, and the recommendation in the Task 19 report.
    expect(REACH_REPORTING_GOVERNANCE.smallCellThreshold).toBe(5);
    expect(REACH_REPORTING_GOVERNANCE.decidedBy).toBe("the service owner");
    expect(REACH_REPORTING_GOVERNANCE.decidedOn).toBe("2026-08-26");
    expect(REACH_REPORTING_GOVERNANCE.basis).toMatch(/by analogy/);
    // The field that stops the number being read as an output of something. A threshold presented
    // as derived when it was chosen is the decaying form of a restated count.
    expect(REACH_REPORTING_GOVERNANCE.restsOn).toMatch(/No calculation over this programme's own data/);
    expect(REACH_REPORTING_GOVERNANCE.revisit).toMatch(/open to revision/i);
  });

  it("is frozen, so no request can move a disclosure control at runtime", () => {
    expect(Object.isFrozen(REACH_REPORTING_GOVERNANCE)).toBe(true);
  });

  it("clears the floor it must clear, which is a property of the decided value and not of the floor", () => {
    // The floor is arithmetic; the value is governance. This is the assertion that the two agree,
    // and it is the one that would catch a future decision set below the point at which suppression
    // suppresses anything.
    expect(REACH_REPORTING_GOVERNANCE.smallCellThreshold).toBeGreaterThanOrEqual(MINIMUM_SUPPRESSING_THRESHOLD);
    expect(discloseReach(ONE_SMALL_CELL, reachReportingThreshold()).kind).toBe("breakdown");
  });

  it("withholds for the absence of a threshold, distinguishably from withholding for the data", () => {
    // Two different facts. `threshold-not-configured` says nothing about the data; the reason in
    // the all-empty case above says nothing about governance. A screen that rendered them
    // identically would tell a reader the wrong one.
    expect(discloseReach(ONE_SMALL_CELL, null)).toEqual({ kind: "withheld", reason: "threshold-not-configured" });
  });

  // SPLIT INTO TWO CASES ON PURPOSE, and the reason is the defect that split them. The pin on the
  // constant used to sit at the top of the behavioural case, so lowering the constant reddened the
  // pin and the loop below it was NEVER REACHED -- which meant the enforcement in `discloseReach`
  // had no mutation covering it at all, while the ledger read as though the floor were proven. An
  // assertion behind a sibling that fails first is not an assertion. The constant's value and the
  // guard's behaviour are two claims and they get two cases.
  it("pins the floor at the lowest threshold that suppresses anything", () => {
    // At 2, "hidden" means "exactly 1" and the marker announces the number it stands for. At 1,
    // nothing is ever hidden. Neither is a policy being disagreed with; both are arithmetic.
    expect(MINIMUM_SUPPRESSING_THRESHOLD).toBe(3);
  });

  it("refuses every threshold below the floor, and accepts the floor itself", () => {
    // No pin on the constant here, deliberately: this case is about what `discloseReach` DOES, and
    // a constant pin ahead of it would swallow this loop the moment the constant moved.
    for (const tooLow of [0, 1, 2]) {
      expect(discloseReach(ONE_SMALL_CELL, tooLow), `threshold ${tooLow}`).toEqual({
        kind: "withheld",
        reason: "threshold-too-low-to-suppress",
      });
    }
    // And the floor itself is usable, so the refusal is a floor rather than a ban.
    expect(discloseReach(ONE_SMALL_CELL, MINIMUM_SUPPRESSING_THRESHOLD).kind).toBe("breakdown");
  });

  it("refuses a count that is not a count", () => {
    expect(() => discloseReach([{ category: "Aboriginal", count: -1 }], THRESHOLD)).toThrow(/non-countable/);
    expect(() => discloseReach([{ category: "Aboriginal", count: 1.5 }], THRESHOLD)).toThrow(/non-countable/);
  });
});

// ---------------------------------------------------------------------------
// Operational measures
// ---------------------------------------------------------------------------

const TEAM = teamId("report-team");
const NOW = new Date("2026-03-02T03:00:00.000Z");
const TODAY = awstCalendarDay(NOW);
const ANOTHER_DAY = "2026-03-01";

function storedContact(id: string, state: ContactState, calendarDay: string): StoredContact {
  return {
    contact: { id: contactId(id), planId: planId("SYN-PLAN-001"), state, version: 1 },
    planned: {
      sequence: 1,
      cadenceLabel: "Day 1",
      calendarDay,
      sendAt: new Date(`${calendarDay}T02:00:00.000Z`),
      messageType: "standard" as MessageType,
    },
  };
}

function planRecord(id: string, state: PlanState, contacts: readonly StoredContact[]): PlanRecord {
  return {
    plan: { id: planId(id), teamId: TEAM, state, version: 1 },
    patientId: patientId(`${id}-patient`),
    referralId: referralId(`${id}-referral`),
    pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
    // Required since Task 9b. Empty rather than populated: this record is assembled by hand rather
    // than seeded, and reporting counts contacts and plans, never attestations.
    assuranceAttestations: [],
    dischargeAt: new Date("2026-02-20T02:00:00.000Z"),
    // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
    // plan's creation instant is set to the same instant as its discharge rather than invented.
    createdAt: new Date("2026-02-20T02:00:00.000Z"),
    completedAt: null,
    outcome: "inProgress",
    contacts,
  };
}

describe("caring-contacts operational reporting", () => {
  it("classifies every contact through the domain's own sendability rule", () => {
    const report = summariseOperationalReport(
      [
        planRecord("SYN-PLAN-001", "active", [
          storedContact("c1", "delivered", ANOTHER_DAY),
          storedContact("c2", "scheduled", ANOTHER_DAY),
          // `missed` sent nothing and is never retried, so it belongs with the contacts that will
          // not be sent -- not with the sends. A report that counted "not suppressed" as "still to
          // come" is the defect `summariseStoredContacts` exists to remove.
          storedContact("c3", "missed", ANOTHER_DAY),
          storedContact("c4", "cancelled", ANOTHER_DAY),
        ]),
      ],
      NOW,
    );

    expect(report.contacts).toEqual({ total: 4, alreadySent: 1, stillToSend: 1, willNotBeSent: 2 });
  });

  it("scopes the day measures to the AWST calendar day, and to that day only", () => {
    const report = summariseOperationalReport(
      [
        planRecord("SYN-PLAN-001", "active", [
          storedContact("c1", "scheduled", TODAY),
          storedContact("c2", "delivered", TODAY),
          storedContact("c3", "scheduled", ANOTHER_DAY),
          storedContact("c4", "delivered", ANOTHER_DAY),
          // Terminal without ever being sent: not still to send, and not already sent, so it is in
          // neither day bucket even though it falls on the day.
          storedContact("c5", "suppressed", TODAY),
        ]),
      ],
      NOW,
    );

    expect(report.today).toEqual({ calendarDay: TODAY, stillToSend: 1, alreadySent: 1 });
    // The whole-programme totals still hold every contact, which is what makes the day scoping
    // above a narrowing rather than a filter applied twice.
    expect(report.contacts.total).toBe(5);
  });

  it("counts plans by the state they are actually in", () => {
    const report = summariseOperationalReport(
      [
        planRecord("SYN-PLAN-001", "active", []),
        planRecord("SYN-PLAN-002", "paused", []),
        planRecord("SYN-PLAN-003", "active", []),
      ],
      NOW,
    );

    expect(report.plans.total).toBe(3);
    expect(report.plans.byState).toEqual([
      { state: "active", count: 2 },
      { state: "paused", count: 1 },
    ]);
  });

  it("reports nothing rather than zero when no plan is held", () => {
    const report = summariseOperationalReport([], NOW);

    expect(report.plans).toEqual({ total: 0, byState: [] });
    expect(report.contacts).toEqual({ total: 0, alreadySent: 0, stillToSend: 0, willNotBeSent: 0 });
    expect(report.today.calendarDay).toBe(TODAY);
  });
});

function dispatch(
  id: string,
  expected: DispatchRecord["expectedStatus"],
  reported: DispatchRecord["reportedStatus"],
  minutesToResolution: number | null,
): DispatchRecord {
  const startedAt = new Date("2026-03-01T00:00:00.000Z");
  return {
    contactId: contactId(id),
    planId: planId("SYN-PLAN-001"),
    attempt: 1,
    startedAt,
    expectedStatus: expected,
    reportedStatus: reported,
    discrepancyResolvedAt:
      minutesToResolution === null ? null : new Date(startedAt.getTime() + minutesToResolution * 60_000),
    discrepancyResolution: minutesToResolution === null ? null : "confirmedDelivered",
  };
}

describe("caring-contacts dispatch differences", () => {
  it("counts a difference only where both statuses are known and they differ", () => {
    const summary = summariseDispatchDiscrepancies([
      dispatch("d1", "delivered", "notDelivered", 10),
      dispatch("d2", "delivered", "delivered", null),
      // Still in flight: nothing has come back to compare, so it is an attempt and not a
      // difference. Counting it would report an open exception against every message in flight.
      dispatch("d3", "delivered", null, null),
      dispatch("d4", null, "delivered", null),
    ]);

    expect(summary.attempts).toBe(4);
    expect(summary.discrepancies).toBe(1);
  });

  it("splits differences into worked through and still open", () => {
    const summary = summariseDispatchDiscrepancies([
      dispatch("d1", "delivered", "notDelivered", 10),
      dispatch("d2", "delivered", "numberInvalid", null),
      dispatch("d3", "delivered", "notDelivered", 30),
    ]);

    expect(summary).toMatchObject({ discrepancies: 3, resolved: 2, unresolved: 1 });
  });

  it("takes the middle value of an odd set and the mean of the middle two of an even set", () => {
    expect(
      summariseDispatchDiscrepancies([
        dispatch("d1", "delivered", "notDelivered", 10),
        dispatch("d2", "delivered", "notDelivered", 50),
        dispatch("d3", "delivered", "notDelivered", 30),
      ]).medianMinutesFromAttemptToResolution,
    ).toBe(30);

    expect(
      summariseDispatchDiscrepancies([
        dispatch("d1", "delivered", "notDelivered", 10),
        dispatch("d2", "delivered", "notDelivered", 50),
        dispatch("d3", "delivered", "notDelivered", 30),
        dispatch("d4", "delivered", "notDelivered", 70),
      ]).medianMinutesFromAttemptToResolution,
    ).toBe(40);
  });

  it("measures the WHOLE attempt, not the time from a difference being noticed", () => {
    // The span, pinned as a number rather than left to the field name. A record whose resolution is
    // recorded ten hours after the attempt began yields ten hours -- the carrier round-trip that
    // happened before the difference existed is inside it, because the record holds no
    // difference-detected instant to measure from. This is what the screen's wording has to match.
    expect(
      summariseDispatchDiscrepancies([dispatch("d1", "delivered", "notDelivered", 600)])
        .medianMinutesFromAttemptToResolution,
    ).toBe(600);
  });

  it("says nothing has been worked through rather than reporting a median of zero", () => {
    // A median of null and a median of 0 are different facts, and 0 is the one a screen would
    // render as an achievement.
    expect(
      summariseDispatchDiscrepancies([dispatch("d1", "delivered", "notDelivered", null)])
        .medianMinutesFromAttemptToResolution,
    ).toBeNull();
    expect(summariseDispatchDiscrepancies([]).medianMinutesFromAttemptToResolution).toBeNull();
    // The positive control on that null: a resolution taking under half a minute genuinely rounds
    // to zero, and must be reported as zero rather than as nothing.
    expect(
      summariseDispatchDiscrepancies([dispatch("d1", "delivered", "notDelivered", 0)])
        .medianMinutesFromAttemptToResolution,
    ).toBe(0);
  });
});
