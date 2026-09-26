/**
 * The one surface language for the Caring Contacts workspace.
 *
 * WHY THIS EXISTS. Eight near-identical "card" definitions had grown across nine files, and they
 * had drifted on three axes at once: two corner radii (`patient-overview.tsx`, `schedule-screen.tsx`
 * and `patients-directory-client.tsx` were `--radius-md` while every other screen was
 * `--radius-lg`), five padding values, and a forced-colours edge that four sites carried and four
 * did not. A clinician moving Patient -> Schedule -> Templates -> Team watched the cards change
 * shape under them. One definition removes the drift by construction rather than by a convention
 * somebody has to remember.
 *
 * WHY NOT `panelSubtle` FROM `@/components/ui-primitives`. Three concrete differences, none of them
 * stylistic:
 *
 *  1. `panelSubtle` ends `forced-colors:border` -- border WIDTH only. This workspace's convention is
 *     `forced-colors:border-[CanvasText]`, width AND colour, and it is asserted directly by
 *     `tests/caring-contacts-empty-state.dom.test.tsx` and
 *     `tests/caring-contacts-patient-overview.dom.test.tsx`. Adopting the shared recipe verbatim
 *     would silently downgrade the whole workspace's high-contrast edge past a green test suite.
 *  2. `panelSubtle` fills with `--surface-raised`; every panel here fills with `--surface`. The
 *     closest shared analogue for an in-flow card is `tableCard`, which is `--surface` + `--e1` +
 *     border -- so keeping `--surface` and ADDING `--e1` is the design-system-consistent move, not
 *     a divergence from it.
 *  3. Padding is genuinely per-role here. Several surfaces are flush sections that own an internal
 *     header band or a table and must carry no padding at all, so a single recipe with baked
 *     padding would be wrong for half the population. Hence the three exports below.
 *
 * A plain constants module rather than a component, matching `width-state.ts`,
 * `contact-vocabulary.ts` and `service-stop-bar-anchors.ts`: it adds no dependency, no client
 * boundary and no chunk, so Ruling 13 is untouched.
 *
 * THE BOUNDARY THAT KEEPS ELEVATION HONEST: a shadow goes on a `--surface` panel and nowhere else.
 * `--surface-subtle` blocks -- `AutomatedState`, `ListEmptyState`, `StatedReason`, every inset well
 * -- stay FLAT. They are recessed, and design-system SPEC §2.4/§2.5 treats a raised well as an
 * elevation inversion. Following that rule is also what keeps the contract's `elevationInversions`
 * ratchet flat without an exception list.
 *
 * Always apply these by NAME (`className={workspacePanelPadded}`), never by pasting the expanded
 * string. `findElevationInversionsInSource` in the design-system contract reads the literal
 * `className` text of each JSX element, so a named constant carries no `--e1` token into the scan
 * and records nothing, while an inlined copy would.
 */

/** The bare card: border, `--surface` fill, one step of elevation, no padding. */
export const workspacePanel =
  "min-w-0 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--e1)] forced-colors:border-[CanvasText]";

/**
 * The padded card, for a panel that lays out its own content.
 *
 * `p-4 sm:p-5` is the value that won: it was already the plan wizard's, and stepping padding up
 * once at `sm` is what the rest of the app does. The sites that were flat `p-4` gain the step; the
 * `px-4 py-4` sites are byte-equivalent at the base band and gain it too.
 */
export const workspacePanelPadded = `${workspacePanel} p-4 sm:p-5`;

/**
 * The flush card, for a section whose first child is a full-bleed header band or a table.
 *
 * `overflow-hidden` is what lets that child's fill reach the rounded corner instead of squaring it
 * off. Used by the team roster, the operational reports and the programme guidance sections, which
 * were three byte-identical copies of this string before.
 */
export const workspacePanelFlush = `${workspacePanel} overflow-hidden`;
