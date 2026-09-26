// tests/helpers/caring-contacts-reach-inference.ts
//
// The inference attempt used against programme-reach suppression, in ONE place.
//
// It is needed twice -- once against `discloseReach`'s output in
// `tests/caring-contacts-reporting.test.ts`, and once against the rendered rows in
// `tests/caring-contacts-guidance-reports-pages.dom.test.tsx` -- and two copies of a safety check
// drift: a weakening applied to one would leave the other quietly checking the old attack, and the
// failure mode is a green suite that no longer covers what it claims to. Same reason
// `caring-contacts-prohibited-language.ts` next door exists.
//
// THE ATTACKER MODEL, stated because an attack is only as good as what it is allowed to know: the
// reader knows the population total. `discloseReach` prints no total and the reach section renders
// none, but a reports screen publishes measures over the same team beside it, so a total is
// knowable whether or not the reach section prints one. That is the conservative assumption and it
// is the one `reach-reporting.ts` is built against.

/** What a reader can SEE: each category, and either its number or the fact that it was hidden. */
export type ReadableCell = { category: string; count: number | "hidden" };

/** Every way `total` can be split across `cells` non-negative integers. */
export function splits(cells: number, total: number): number[][] {
  if (total < 0) return [];
  if (cells === 0) return total === 0 ? [[]] : [];
  if (cells === 1) return [[total]];
  const found: number[][] = [];
  for (let first = 0; first <= total; first += 1) {
    for (const rest of splits(cells - 1, total - first)) found.push([first, ...rest]);
  }
  return found;
}

/**
 * Every hidden category whose exact number a reader could work out from what they were shown.
 *
 * The published cells and the total give the residual, which is what the hidden cells sum to. A
 * hidden cell is recovered when every split of that residual gives it the same value -- which is
 * always true of a lone hidden cell, and is what makes naive suppression decoration.
 */
export function recoverableCategories(readable: readonly ReadableCell[], total: number): string[] {
  const hidden = readable.filter((cell) => cell.count === "hidden");
  if (hidden.length === 0) return [];
  const published = readable.reduce((running, cell) => (cell.count === "hidden" ? running : running + cell.count), 0);
  const feasible = hidden.map(() => new Set<number>());
  for (const split of splits(hidden.length, total - published)) {
    split.forEach((value, index) => feasible[index].add(value));
  }
  return hidden.filter((_, index) => feasible[index].size === 1).map((cell) => cell.category);
}

/**
 * The implementation the real rule exists to be better than: hide the small cells and stop.
 *
 * Kept here rather than written inline at each call site because it is the POSITIVE CONTROL for
 * `recoverableCategories` -- an attack that cannot recover a cell from this proves nothing by
 * failing to recover one from the real disclosure.
 */
export function naiveSuppression(
  cells: readonly { category: string; count: number }[],
  threshold: number,
): ReadableCell[] {
  return cells.map((cell) => ({ category: cell.category, count: cell.count < threshold ? "hidden" : cell.count }));
}
