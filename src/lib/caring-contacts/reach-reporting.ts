// src/lib/caring-contacts/reach-reporting.ts
//
// Small-cell suppression for programme-reach reporting (spec §2.5).
//
// WHAT THIS MODULE IS FOR, AND WHY IT EXISTS BEFORE THE SCREEN THAT WOULD USE IT
// -----------------------------------------------------------------------------
// Spec §2.5 promises aggregate reporting on programme reach with a governance-configured
// small-cell threshold and a non-inferable `Suppressed` state. The threshold now exists (see
// below); the FIELD IT WOULD REPORT ON DOES NOT. This system records no Aboriginal and Torres
// Strait Islander status, so `/caring-contacts/reports` currently discloses nothing at all and its
// reach section says exactly that -- not an empty breakdown, which would read as a statement about
// patients rather than about collection.
//
// So this module is complete and, for now, unexercised by any screen. That is deliberate: the RULE
// belongs here rather than in the screen, for the reason the standing constraints give -- a
// suppression threshold is a rule, and a screen must never re-derive a rule a module owns. When a
// bounded category set exists and the field is recorded again, the screen changes by passing cells
// to `discloseReach`; nothing about the arithmetic below moves into a component.
//
// WHY NAIVE SUPPRESSION IS DECORATION
// -----------------------------------
// Suppressing every cell below the threshold and publishing the rest is not a disclosure control.
// If exactly one cell is suppressed, that cell is the total minus the cells that were published --
// one subtraction, and the "suppression" has told the reader the number it was hiding. The same
// holds whenever the arithmetic pins a suppressed cell to a single feasible value.
//
// THE ASSUMPTION THIS MODULE MAKES, STATED SO IT IS NOT MISTAKEN FOR CAUTION
// -------------------------------------------------------------------------
// It assumes the population total IS KNOWABLE. `discloseReach` never emits a total, but the safety
// argument does not rest on that: a reports screen publishes operational measures over the same
// team beside the reach section, and a reader who can count the team's plans has the total whether
// or not this function prints it. Withholding it is worth doing anyway and buys nothing on its own.
//
// SO THE RULE IS COMPLEMENTARY SUPPRESSION, AND WITHHOLDING WHEN THAT CANNOT WORK
// ------------------------------------------------------------------------------
// After the cells below the threshold are suppressed, further cells are promoted into the
// suppressed set -- smallest first -- until no suppressed cell's value is pinned by the arithmetic.
// Promotion is what buys the ambiguity: a reader who knows the rule cannot tell a cell suppressed
// for being small from a cell suppressed to hide it. When no promotion can achieve that, the whole
// breakdown is withheld rather than published with a recoverable cell in it.
//
// WHAT IS DELIBERATELY NOT MODELLED, AND WHERE THE OTHER HALF OF IT LIVES: differencing across two
// reports that share a population but differ in scope. Two such reports can be subtracted from each
// other, and no per-report rule can prevent it -- so the defence is a property of the SURFACE
// rather than of this function.
//
//   * THE FILTER AXIS is closed by construction and pinned: the reach section offers no control
//     that would produce a second, differently-scoped reach report.
//     `tests/caring-contacts-guidance-reports-pages.dom.test.tsx` fails on any interactive element
//     inside the section, whatever it is called. It was a paragraph and nothing else until that
//     test existed, which meant a later task could have added a filter beside it with every gate
//     green.
//   * THE TEMPORAL AXIS IS NOT CLOSED. Two reports taken at different times over a growing
//     population can be differenced the same way, and nothing here or on the screen prevents it.
//     There is no live exposure -- the section discloses nothing at all today -- but it is an open
//     gap rather than a handled one, and it is recorded as such in the Task 19 report. Closing it
//     needs a decision about what a reach report is AS AT: a frozen reporting period, or a
//     published as-at instant that makes two reports comparable rather than differenceable.
//
// THE THRESHOLD IS AN INPUT, AND IT NOW HAS AN OWNER. It is 5, decided by the service owner on
// 2026-08-26 by analogy to common practice and explicitly open to revision. The value and its
// provenance live in ./reach-reporting-governance; `reachReportingThreshold()` below reads it and
// `discloseReach` takes it as a required argument. Nothing in this file chooses a number.
import { REACH_REPORTING_GOVERNANCE } from "./reach-reporting-governance";

/** One category and how many members it has, before any disclosure decision is made. */
export type ReachCell = { readonly category: string; readonly count: number };

/**
 * One category as it may be READ. A suppressed cell carries no count at all -- not zero, not null
 * on a `count` field a caller might coalesce, but a shape with no count property to reach for.
 */
export type DisclosedReachCell =
  | { readonly category: string; readonly disclosed: true; readonly count: number }
  | { readonly category: string; readonly disclosed: false };

/**
 * Why a breakdown was withheld whole. Each value is a different fact and a surface that renders
 * them identically is making a statement it did not check:
 *
 *   * `threshold-not-configured` -- nobody has set the governance threshold, so no suppression
 *     decision can be made at all. This says nothing about the data.
 *   * `threshold-too-low-to-suppress` -- a threshold below `MINIMUM_SUPPRESSING_THRESHOLD` marks
 *     cells whose value it thereby reveals; see that constant.
 *   * `no-safe-disclosure` -- a threshold IS configured and the data cannot be published under it
 *     without a suppressed cell being recoverable by arithmetic.
 */
export type ReachWithholdingReason =
  "threshold-not-configured" | "threshold-too-low-to-suppress" | "no-safe-disclosure";

export type ReachDisclosure =
  | { readonly kind: "breakdown"; readonly cells: readonly DisclosedReachCell[] }
  | { readonly kind: "withheld"; readonly reason: ReachWithholdingReason };

/**
 * The lowest threshold at which suppression suppresses anything.
 *
 * DERIVED, NOT CHOSEN, and the distinction matters because choosing a threshold is exactly the
 * governance decision this module refuses to make. At a threshold of 2, "suppressed" means
 * "count < 2", and every non-empty suppressed cell therefore holds exactly 1 -- the marker
 * announces the number. At 1, nothing is ever suppressed. Neither is a policy this file is
 * disagreeing with; both are arithmetic that makes the control do nothing, so a threshold below 3
 * is refused by name rather than silently applied.
 *
 * This is a FLOOR on a configured value, never a default for a missing one.
 */
export const MINIMUM_SUPPRESSING_THRESHOLD = 3;

/**
 * The governance-configured small-cell threshold, or `null` when there is none.
 *
 * IT READS THE DECISION, IT DOES NOT MAKE ONE. The value is the owner's, taken on 2026-08-26, and
 * it lives in `./reach-reporting-governance` beside the record of who took it, what it was chosen
 * by, and what it is NOT an output of. A literal here would be a disclosure control set by whoever
 * happened to write this file -- the shape of the decision the owner declined on 2026-08-25, when
 * he refused a data-cleaning step that would silently have decided who counts as Aboriginal.
 *
 * It is still typed `number | null`, and that is not vestigial. `discloseReach` must go on
 * accepting "no threshold is set" as a first-class answer, because a future configuration source --
 * a stored, per-service row rather than a committed decision -- can genuinely be absent, and the
 * withheld-for-no-threshold state must remain reachable rather than becoming dead wording.
 *
 * A function rather than a constant so the call site reads as a lookup that can fail, and so a
 * later configuration source is a change of body rather than a change of every caller.
 */
export function reachReportingThreshold(): number | null {
  return REACH_REPORTING_GOVERNANCE.smallCellThreshold;
}

/** Non-negative integers only; a negative or fractional count is a broken caller, not a small cell. */
function assertCountable(cells: readonly ReachCell[]): void {
  for (const cell of cells) {
    if (!Number.isInteger(cell.count) || cell.count < 0) {
      throw new Error(`caring-contacts reach reporting: ${cell.category} has a non-countable value`);
    }
  }
}

/**
 * Whether the arithmetic pins some suppressed cell to a single value.
 *
 * `suppressedCount` is how many cells carry no number; `residual` is the population total minus
 * every published cell, which is what those cells sum to. A reader who knows the total knows both.
 *
 *   * nothing suppressed -- there is no hidden cell to pin;
 *   * exactly one suppressed -- it IS the residual, by one subtraction. This is naive suppression
 *     and it is the case the whole module exists for;
 *   * residual zero -- every suppressed cell is zero, whatever their number, so each is pinned;
 *   * otherwise -- two or more non-negative integers summing to a positive residual admit more
 *     than one assignment, so no cell has a single feasible value.
 *
 * The last clause is why promotion works: a reader cannot tell a cell suppressed for being small
 * from one promoted to hide it, so no per-cell upper bound survives to narrow the assignments.
 */
function pinsASuppressedCell(suppressedCount: number, residual: number): boolean {
  if (suppressedCount === 0) return false;
  if (suppressedCount === 1) return true;
  return residual === 0;
}

/**
 * The reach breakdown as it may be read, or the reason it may not be read at all.
 *
 * `threshold` is the governance-configured value and is REQUIRED -- passing `null` states that
 * none is configured and yields the withheld shape for that reason. There is deliberately no
 * default parameter: a caller that forgets the argument must not silently acquire a threshold.
 */
export function discloseReach(cells: readonly ReachCell[], threshold: number | null): ReachDisclosure {
  if (threshold === null) return { kind: "withheld", reason: "threshold-not-configured" };
  if (!Number.isInteger(threshold) || threshold < MINIMUM_SUPPRESSING_THRESHOLD) {
    return { kind: "withheld", reason: "threshold-too-low-to-suppress" };
  }
  assertCountable(cells);

  const total = cells.reduce((running, cell) => running + cell.count, 0);
  const suppressed = new Set<number>();
  for (const [index, cell] of cells.entries()) {
    if (cell.count < threshold) suppressed.add(index);
  }

  // Smallest first, ties by declared order, so promotion costs the least information it can and
  // two runs over the same data promote the same cells.
  const promotionOrder = cells
    .map((cell, index) => ({ index, count: cell.count }))
    .sort((left, right) => left.count - right.count || left.index - right.index)
    .map((entry) => entry.index);

  const residual = (): number =>
    total - cells.reduce((running, cell, index) => (suppressed.has(index) ? running : running + cell.count), 0);

  while (pinsASuppressedCell(suppressed.size, residual())) {
    const promote = promotionOrder.find((index) => !suppressed.has(index));
    // Every cell is already suppressed and the arithmetic still pins one -- which is the all-zero
    // breakdown, and a single-category breakdown of a small cell. Neither can be made safe by
    // hiding more, so the breakdown is withheld whole.
    if (promote === undefined) return { kind: "withheld", reason: "no-safe-disclosure" };
    suppressed.add(promote);
  }

  return {
    kind: "breakdown",
    cells: cells.map((cell, index) =>
      suppressed.has(index)
        ? { category: cell.category, disclosed: false }
        : { category: cell.category, disclosed: true, count: cell.count },
    ),
  };
}
