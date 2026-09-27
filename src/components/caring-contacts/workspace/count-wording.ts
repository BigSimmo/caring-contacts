/**
 * "1 contact" / "3 contacts": a count and the noun that agrees with it.
 *
 * One definition for the workspace. Four screens each carried an identical private copy, which is
 * how wording rules drift apart.
 */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
