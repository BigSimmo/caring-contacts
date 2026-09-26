import { expect, test, type Page } from "playwright/test";

import { CARING_CONTACTS_ROUTES } from "../src/lib/caring-contacts-routes";
import { widthStateFor, WORKSPACE_WIDTH_BREAKPOINTS } from "../src/components/caring-contacts/workspace/width-state";

/**
 * Every Caring Contacts screen, at every reviewed width, WITH RECORDS ON IT.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `ui-caring-contacts-workspace.spec.ts` sweeps the same screens at the same widths and is the
 * more thorough file in every other respect — but it runs against `run-playwright.mjs`'s PRIMARY
 * server, whose Caring Contacts store is deliberately empty (`demoSeedRequested()` excludes any
 * process carrying `PLAYWRIGHT_OFFLINE_MODE` unless `CARING_CONTACTS_DEMO_SEED=on`). That
 * emptiness is correct and load-bearing there: it is what keeps its "an empty caseload is served
 * as a page, not a missing resource" observations honest, and seeding that server would delete
 * them rather than add anything.
 *
 * The consequence is that until this file, EVERY assertion this repository held about Caring
 * Contacts layout was measured on a screen with no rows in it. "Holds the frozen layout at 320px"
 * meant an empty caseload held it. A table with one column of content cannot overflow; a day strip
 * with no counts cannot push a cell wide; a patient card with no name cannot wrap. The layouts
 * that break are the populated ones, and they had no browser gate at all.
 *
 * So this runs on the SECOND server, the seeded one, alongside
 * `ui-caring-contacts-activation.spec.ts` — same isolated build, seed on, base URL published as
 * `PLAYWRIGHT_SEEDED_BASE_URL`.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * IT WRITES NOTHING, and that is what lets it share a server with the activation journey. That
 * spec is `mode: "serial"` because it creates a plan for `demo-seed-patient-wren` and a second
 * creating run against one server is correctly refused as `duplicateActivePlan`. Every navigation
 * below is a GET and every assertion is geometric, so the two cannot interfere in either
 * direction.
 *
 * For the same reason it asserts NO COUNTS and NO ROW IDENTITIES. The activation journey may add a
 * plan to this store while this file is running, so "three patients" would be a race rather than a
 * contract. What it asserts is that whatever the store holds, it lays out: nothing spills
 * sideways, the right navigation owns the screen for the width, and the fixed dock covers nothing.
 * The population is the INPUT, never the subject.
 *
 * The one non-geometric assertion is that the screen actually has records on it — without it a
 * regression that served an empty page everywhere would pass this whole file while proving
 * nothing, which is the exact failure mode described above.
 */

/**
 * The seven widths `docs/caring-contacts/accessibility-acceptance.md` makes blocking, in full.
 *
 * The workspace spec's own sweep stops at 1440. 1920 is in the acceptance list and is the width at
 * which the shell's `min-[1440px]:max-w-[90rem]` measure cap is the only thing between the content
 * and a very wide column, so it is the width where that cap is either doing its job or is not.
 */
const REVIEW_WIDTHS = [320, 390, 430, 768, 1024, 1440, 1920] as const;

const VIEWPORT_HEIGHT = 900;

/**
 * The screens, and the heading each serves.
 *
 * Routes come from `CARING_CONTACTS_ROUTES` rather than string literals, so a route renamed in the
 * one place routes are declared cannot leave this sweep quietly pointed at a 404 that happens to
 * render no overflow.
 */
const SCREENS = [
  { name: "Today", route: CARING_CONTACTS_ROUTES.today, heading: "Today" },
  { name: "Patients", route: CARING_CONTACTS_ROUTES.patients, heading: "Patients" },
  { name: "Schedule", route: CARING_CONTACTS_ROUTES.schedule, heading: "Schedule" },
  { name: "Templates", route: CARING_CONTACTS_ROUTES.templates, heading: "Templates" },
  { name: "Team", route: CARING_CONTACTS_ROUTES.team, heading: "Team" },
  { name: "Reports", route: CARING_CONTACTS_ROUTES.reports, heading: "Reports" },
  { name: "Guidance", route: CARING_CONTACTS_ROUTES.guidance, heading: "Guidance" },
] as const;

/** Screens whose body is a list of records, and which therefore have something to be empty. */
const POPULATED_LIST_SCREENS = new Set(["Patients", "Templates", "Team"]);

/**
 * Opens one screen and settles the shell before anything is measured.
 *
 * The rail count is not politeness: React streams the segment under `loading.tsx`'s Suspense
 * boundary into a hidden holder before moving it into place, so a page sampled too early carries a
 * second inert copy of the whole shell and every measurement below would be taken against two
 * overlapping layouts.
 */
async function openScreen(page: Page, width: number, route: string, heading: string) {
  await page.setViewportSize({ width, height: VIEWPORT_HEIGHT });
  await page.goto(route, { waitUntil: "load" });
  await expect(page.getByTestId("caring-contacts-rail")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
}

/** Horizontal overflow of the document against the viewport, in CSS pixels. */
function documentOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

/** The width-state markers the shell displays one at a time. */
function displayedWidthStates(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll("[data-workspace-width-state]")]
      // `getClientRects()` is empty for anything an ancestor has hidden, which a bare `display`
      // read on the element itself would miss entirely.
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => node.getAttribute("data-workspace-width-state")),
  );
}

/**
 * Any element whose own box is wider than the viewport, split by why that is happening.
 *
 * Document overflow alone is not the whole question on a populated screen: something that overruns
 * its column inside a region that governs horizontal overflow produces no document overflow at
 * all. What it means for the clinician depends entirely on WHICH `overflow-x` governs it.
 *
 * - `auto` / `scroll` — the region declared itself scrollable, so it is allowed to hold something
 *   wider than itself and the reader can reach the rest. That is the sanctioned pattern for a wide
 *   data table (the team ownership table's wrapper is exactly this), and it is exempt.
 * - `hidden` — the region clips. Nothing scrolls, nothing overflows the document, and whatever did
 *   not fit is simply absent from the screen with no indication it was ever there. That is the
 *   silent failure this helper exists to catch, and it is reported as `clipped:`.
 *
 * The distinction is load-bearing here rather than theoretical: `workspacePanelFlush`
 * (`workspace/surfaces.ts`) ends in `overflow-hidden`, and Reports, Guidance and Team are built
 * from it. Lumping `hidden` in with the scrollable exemption would excuse those three screens from
 * the one gate written for them.
 *
 * Offenders carry tag and class so a failure names the element rather than only the width it
 * happened at.
 */
function elementsWiderThanViewport(page: Page) {
  return page.evaluate(() => {
    const offenders: string[] = [];
    for (const node of document.querySelectorAll<HTMLElement>("main *")) {
      const rect = node.getBoundingClientRect();
      if (rect.width <= window.innerWidth + 1) continue;

      // The nearest ancestor (or the node itself) that governs horizontal overflow decides. Null
      // means nothing governs it and the box is overflowing in the open.
      let governor: "scrolls" | "clips" | null = null;
      for (let a: HTMLElement | null = node; a !== null && governor === null; a = a.parentElement) {
        const overflowX = getComputedStyle(a).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") governor = "scrolls";
        else if (overflowX === "hidden") governor = "clips";
      }
      if (governor === "scrolls") continue;

      const label = `${node.tagName.toLowerCase()}.${node.className.toString().slice(0, 80)}`;
      offenders.push(governor === "clips" ? `clipped:${label}` : `overflows:${label}`);
    }
    return offenders;
  });
}

for (const screen of SCREENS) {
  test.describe(`caring-contacts ${screen.name}, populated`, () => {
    for (const width of REVIEW_WIDTHS) {
      test(`lays out at ${width}px with records on it`, async ({ page }) => {
        await openScreen(page, width, screen.route, screen.heading);

        // The screen is genuinely populated. Without this the whole sweep would pass against a
        // regression that served an empty page at every width — which is the state this file
        // exists because the other sweep is already measuring.
        if (POPULATED_LIST_SCREENS.has(screen.name)) {
          await expect(
            page.getByTestId("caring-contacts-list-empty-state"),
            `${screen.name} rendered an empty state on the SEEDED server — the seed did not reach this screen, so nothing below measures a populated layout`,
          ).toHaveCount(0);
        }

        // Nothing spills sideways. This is the failure that makes a phone screen unusable, and on
        // a populated screen it is a real possibility rather than a formality.
        expect(
          await documentOverflow(page),
          `horizontal document overflow on ${screen.name} at ${width}px`,
        ).toBeLessThanOrEqual(2);

        // …and nothing inside the content is wider than the viewport unless it declared itself
        // scrollable. `clipped:` means an `overflow-hidden` ancestor is silently hiding the excess;
        // `overflows:` means it is spilling in the open. See `elementsWiderThanViewport`.
        expect(
          await elementsWiderThanViewport(page),
          `content wider than the viewport on ${screen.name} at ${width}px`,
        ).toEqual([]);

        // Exactly one width state is displayed, and it is the one the frozen module names. Two
        // displayed markers means overlapping media classes.
        expect(await displayedWidthStates(page), `width state at ${width}px`).toEqual([widthStateFor(width)]);

        const rail = page.getByTestId("caring-contacts-rail");
        const dock = page.getByTestId("caring-contacts-phone-dock");

        if (width < WORKSPACE_WIDTH_BREAKPOINTS.rail) {
          await expect(dock).toBeVisible();
          await expect(rail).toBeHidden();

          // The bottom reserve, measured where it actually matters: the END of a populated page.
          // The empty-store sweep scrolls to a short page whose last element is a navigation row;
          // here the page is as long as the records make it, which is the length a reserve
          // derived from the dock has to survive.
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const dockBox = await dock.boundingBox();
          const lastControl = page.getByRole("button", { name: "Coverage" });
          const lastBox = await lastControl.boundingBox();
          expect(dockBox, "phone dock has no box").not.toBeNull();
          expect(lastBox, "last More destination has no box").not.toBeNull();
          expect(
            lastBox!.y + lastBox!.height,
            `the last destination is under the dock on ${screen.name} at ${width}px — the bottom reserve is too small`,
          ).toBeLessThanOrEqual(dockBox!.y);
        } else {
          await expect(rail).toBeVisible();
          await expect(dock).toBeHidden();
        }
      });
    }

    /**
     * The 400%-zoom reflow case, which `accessibility-acceptance.md` makes blocking.
     *
     * 400% zoom on a 1280px viewport is equivalent to a 320px CSS viewport, and the acceptance
     * criterion is that the page reflows to a compact composition with no horizontal DOCUMENT
     * scrolling. Expressed as the equivalent viewport rather than by driving a zoom level, which
     * is how the workspace spec already spells it.
     */
    test("reflows at the 400%-zoom equivalent with records on it", async ({ page }) => {
      await openScreen(page, 320, screen.route, screen.heading);
      expect(
        await documentOverflow(page),
        `${screen.name} does not reflow at the 400%-zoom equivalent of a 1280px viewport`,
      ).toBeLessThanOrEqual(2);
    });
  });
}
