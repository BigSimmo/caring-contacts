import { expect, test, type Page } from "playwright/test";

import { PLAN_DRAFT_STORAGE_KEY } from "../src/components/caring-contacts/workspace/plan-wizard/plan-draft";
import { DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS } from "../src/lib/caring-contacts/synthetic-contacts";

/**
 * The Caring Contacts activation wizard, driven end to end in a real browser (#JZA0XK).
 *
 * WHY THIS FILE EXISTS AND WHY IT IS NOT IN `ui-caring-contacts-workspace.spec.ts`
 * -------------------------------------------------------------------------------
 * The workspace spec runs against `run-playwright.mjs`'s PRIMARY server, whose Caring Contacts
 * store is deliberately EMPTY: `demoSeedRequested()` excludes any process carrying
 * `PLAYWRIGHT_OFFLINE_MODE` unless `CARING_CONTACTS_DEMO_SEED=on`, and that exclusion is what keeps
 * the empty-caseload observations in that file honest — including its assertion that the wizard has
 * count 0 on `/caring-contacts/plans/new`. Those are real production states (a newly onboarded team
 * has no patients on day one), not fixtures, and switching the seed on for that server would delete
 * them rather than add anything.
 *
 * So this journey runs against a SECOND server: same isolated build, second port, seed on, started
 * by `run-playwright.mjs` and published as `PLAYWRIGHT_SEEDED_BASE_URL`. The
 * `chromium-caring-contacts-seeded` project in `playwright.config.ts` is the only project pointed
 * at it, and `seededSpecPattern` there names only this file. The design is the one recorded in
 * `docs/caring-contacts/phase-2b-sdd-archive/task-seed-report.md`; nothing here invents it.
 *
 * WHAT IT PROVES THAT NOTHING ELSE CAN
 * ------------------------------------
 *  1. The wizard MOUNTS. It is this workspace's only Client Component (Ruling [109]) and it reads
 *     its draft through `useSyncExternalStore` with a `getServerSnapshot`, so a server render that
 *     never hydrates looks identical in markup to one that did. Only a browser can tell them apart,
 *     and the tell is that the interface responds.
 *  2. A draft SURVIVES A RELOAD — the owner decision the client boundary was spent on, held in this
 *     tab's `sessionStorage` under `PLAN_DRAFT_STORAGE_KEY`. jsdom can exercise the module; only a
 *     browser can exercise an actual page reload restoring it.
 *  3. The sensitive inputs and the mobile caution RENDER AND MEET THE TAP FLOOR at 320px, in dark,
 *     and under forced colours — measured from the rendered box, never from a class string, which is
 *     the weakness the issue names.
 *  4. THE TWO-WRITE MIDDLE STATE. Stage 4 creates the plan and then starts it, and
 *     `created-not-started` is the state between them: the plan exists, it has not started, and the
 *     draft is kept precisely so the next press finishes THE SAME plan instead of creating a second
 *     one for this patient. It is reached here by blocking only the activation request, so the
 *     create genuinely succeeds and the activation genuinely fails.
 *
 * ONE CREATING JOURNEY, AND THE ORDER IS FIXED. `demo-seed-patient-wren` has no other plan, so a
 * second creating run against one server is correctly refused as `duplicateActivePlan`. Case 4 is
 * that one journey, and `mode: "serial"` keeps it the last thing this file does.
 */
test.describe.configure({ mode: "serial" });

/**
 * The seeded referral the wizard starts from.
 *
 * The literal, not an import: `demo-seed.ts` carries `import "server-only"`, which throws the
 * moment a non-server module loads it, so a spec cannot read `DEMO_SEED_UNSTARTED_REFERRAL_ID`
 * from where it is declared. It is exported there for exactly this purpose and is the wizard's only
 * entry point — no screen lists referrals yet. If it is ever renamed, this file's first navigation
 * lands on `referral-not-visible` and every case below fails loudly rather than quietly proving
 * nothing.
 */
const SEEDED_REFERRAL_ID = "demo-seed-referral-wren";
/** The patient that referral names. Same source, same reason for the literal. */
const SEEDED_PATIENT_ID = "demo-seed-patient-wren";
/** The one approved pathway version the seed publishes; stage 2's single option. */
const SEEDED_PATHWAY_VERSION_ID = "demo-seed-pathway-version-1";

const WIZARD_ROUTE = `/caring-contacts/plans/new?referral=${SEEDED_REFERRAL_ID}`;
const WIZARD_TESTID = "caring-contacts-plan-wizard";
const MOBILE_CAUTION_TESTID = "caring-contacts-patient-mobile-caution";

/** The create collection, and the lifecycle endpoint for one plan. Both from `plan-wizard.tsx`. */
const CREATE_PLAN_PATH = "/api/caring-contacts/plans";
const activationPathPattern = /^\/api\/caring-contacts\/plans\/[^/]+$/;

/**
 * Production's tap floor in this repository is 48px (`--spacing-tap`, `min-h-tap`), which exceeds
 * both WCAG 2.5.8 (24px) and 2.5.5 (44px). Generic checklist guidance teaches 44; asserting that
 * here would license a regression the repository has already refused, so the number is read off the
 * design token's own value.
 */
const TAP_FLOOR_PX = 48;

/** A reserved fictional number the wizard states in place, and one that is deliberately not. */
const RESERVED_MOBILE = DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS[0];
const UNRESERVED_MOBILE = "0400 111 222";

/**
 * The seeded server's URL, and a hard refusal to run without it.
 *
 * `playwright.config.ts` falls back to the primary `baseURL` when this is unset, because a config
 * that threw would break collection for every other project. That fallback must never be reached
 * silently HERE: the primary server holds no referral, so the wizard would render a
 * `PlanStartStateNotice` and each case below would fail with a confusing "wizard not found" instead
 * of "nobody started the seeded server".
 */
const seededBaseUrl = process.env.PLAYWRIGHT_SEEDED_BASE_URL;

test.beforeAll(() => {
  expect(
    seededBaseUrl,
    "PLAYWRIGHT_SEEDED_BASE_URL is unset. This spec needs the seeded Caring Contacts server that " +
      "scripts/run-playwright.mjs starts for the chromium-caring-contacts-seeded project; run it " +
      "through `npm run test:e2e:caring-contacts-activation` rather than a bare `playwright test`.",
  ).toBeTruthy();
});

/** Opens the wizard for the seeded referral and waits for the Client Component to be on screen. */
async function openWizard(page: Page) {
  await page.goto(WIZARD_ROUTE);
  await expect(page.getByTestId(WIZARD_TESTID)).toBeVisible();
}

/** Stage 1: both confirmations, then on to the pathway stage. */
async function completeAgreement(page: Page) {
  const assurances = page.getByRole("group", { name: "Assurances you are confirming" });
  const boxes = assurances.getByRole("checkbox");
  await expect(boxes).toHaveCount(2);
  for (const box of await boxes.all()) await box.check();
  await page.getByRole("button", { name: /Continue to pathway/ }).click();
  await expect(page.getByRole("region", { name: "Pathway" })).toBeVisible();
}

/** Stage 2: the one approved version the seed publishes, then on to personalisation. */
async function choosePathway(page: Page) {
  const chooser = page.getByRole("group", { name: "Choose a governed pathway version" });
  await chooser.getByRole("radio", { name: SEEDED_PATHWAY_VERSION_ID }).check();
  await page.getByRole("button", { name: /Continue to personalisation/ }).click();
  await expect(page.getByRole("region", { name: "Personalisation" })).toBeVisible();
}

/** Stage 3: the details a referral does not carry, then on to review and activation. */
async function completePersonalisation(page: Page, { mobile = RESERVED_MOBILE } = {}) {
  await page.getByLabel("Patient’s name").fill("Wren Example");
  await page.getByLabel("What should we call them in messages?").fill("Wren");
  await page.getByLabel("Mobile number this plan will use").fill(mobile);
  await page
    .getByRole("group", { name: "When in the day messages go out" })
    .getByRole("radio", { name: "Morning" })
    .check();
  await page.getByRole("button", { name: /^Continue to review/ }).click();
  await expect(page.getByRole("region", { name: "Review and activation" })).toBeVisible();
}

/**
 * Stage 4's discharge day.
 *
 * Taken from the clock rather than pinned to a literal: nothing in this domain refuses a past
 * discharge day today, and a hardcoded date would be the kind of fixture that keeps passing for a
 * year and then starts asserting something nobody meant. The first-contact day is left at the
 * default the screen offers (discharge + 1).
 */
function todayCalendarDay(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Opens the final-activation confirmation overlay and presses its own decision control. */
async function confirmActivation(page: Page) {
  await page.locator('[data-testid="workspace-overlay-trigger"][data-overlay-trigger="final-activation"]').click();
  const action = page.getByTestId("workspace-overlay-action");
  await expect(action).toBeVisible();
  await action.click();
}

test.describe("caring contacts activation wizard (seeded server)", () => {
  test("mounts as a hydrated Client Component for the seeded referral", async ({ page }) => {
    await openWizard(page);

    // The wizard rendered rather than a `PlanStartStateNotice`, which is the whole difference the
    // seeded server buys: on the unseeded server this route renders the notice and nothing else.
    const wizard = page.getByTestId(WIZARD_TESTID);
    await expect(wizard).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sign-up stages" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Agreement" })).toBeVisible();

    // HYDRATION, not markup. The server render cannot tick a box or enable a control, so a wizard
    // whose client bundle never took over fails here while looking identical in the HTML.
    const forward = page.getByRole("button", { name: /Continue to pathway/ });
    await expect(forward).toBeDisabled();
    const boxes = page.getByRole("group", { name: "Assurances you are confirming" }).getByRole("checkbox");
    for (const box of await boxes.all()) await box.check();
    await expect(forward).toBeEnabled();

    // ...and the draft store the hydrated component writes through is this tab's sessionStorage.
    const stored = await page.evaluate((key) => window.sessionStorage.getItem(key), PLAN_DRAFT_STORAGE_KEY);
    expect(stored, "the hydrated wizard wrote no draft").not.toBeNull();
  });

  test("keeps a typed draft across a page reload", async ({ page }) => {
    await openWizard(page);
    await completeAgreement(page);
    await choosePathway(page);

    const name = page.getByLabel("Patient’s name");
    await name.fill("Wren Example");
    await expect(name).toHaveValue("Wren Example");

    await page.reload();

    // The stage AND the value come back: a reload that restarted the sign-up would land on stage 1
    // with an empty form, which is the outcome Ruling [110] spent the client boundary to prevent.
    await expect(page.locator(`[data-testid="${WIZARD_TESTID}"]:visible`)).toBeVisible();
    await expect(page.getByRole("region", { name: "Personalisation" })).toBeVisible();
    await expect(page.getByLabel("Patient’s name")).toHaveValue("Wren Example");
  });

  test("renders the sensitive inputs and the mobile caution at 320px, in dark, under forced colours", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", forcedColors: "active" });

    await openWizard(page);
    await completeAgreement(page);
    await choosePathway(page);

    const name = page.getByLabel("Patient’s name");
    const preferred = page.getByLabel("What should we call them in messages?");
    const mobile = page.getByLabel("Mobile number this plan will use");

    for (const field of [name, preferred, mobile]) {
      await expect(field).toBeVisible();
      // MEASURED FROM THE RENDERED BOX. Reading `min-h-tap` off the class attribute would pass for
      // a field whose own rule was overridden, or clipped by a 320px parent, and that is the
      // weakness #JZA0XK names. 48px is this repository's floor; never assert 44 here.
      const box = await field.boundingBox();
      expect(box, "the field has no rendered box").not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
      // Nothing may spill sideways at 320px — a field wider than the viewport is unreachable.
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    }

    // The statement that nothing typed here is ever sent, naming the reserved numbers in place
    // (Ruling [115]). It is the whole protection on this field, so it has to actually arrive.
    const neverSent = page.getByRole("group", { name: "Nothing typed here is ever sent to any number" });
    await expect(neverSent).toBeVisible();
    for (const reserved of DESIGNATED_FICTIONAL_PATIENT_MOBILE_NUMBERS) {
      await expect(neverSent).toContainText(reserved);
    }

    // The live region is on the page BEFORE it has anything to say — inserting a live region along
    // with its content is what stops it being announced (round 1, finding I-2) — and it is named by
    // the input it is about.
    const caution = page.getByTestId(MOBILE_CAUTION_TESTID);
    await expect(caution).toBeAttached();
    await expect(caution).toHaveAttribute("role", "status");
    await expect(mobile).toHaveAttribute("aria-describedby", new RegExp(MOBILE_CAUTION_TESTID));

    await mobile.fill(RESERVED_MOBILE);
    await expect(caution).toHaveText("");

    await mobile.fill(UNRESERVED_MOBILE);
    await expect(caution).toBeVisible();
    await expect(caution).toContainText("not one of the reserved fictional numbers");

    const forward = page.getByRole("button", { name: /^Continue to review/ });
    const forwardBox = await forward.boundingBox();
    expect(forwardBox, "the forward control has no rendered box").not.toBeNull();
    expect(forwardBox!.height).toBeGreaterThanOrEqual(TAP_FLOOR_PX);
  });

  test("recovers a created-but-not-started plan by finishing the same plan (Ruling [123])", async ({ page }) => {
    /**
     * The two writes, observed. Bodies rather than counts alone: what makes the second press a
     * retry rather than a second plan for this patient is that it sends the SAME `planId` and the
     * SAME idempotency keys (Ruling [120]), so the service replays the first answer.
     */
    const createBodies: string[] = [];
    const activationPaths: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "POST") return;
      const { pathname } = new URL(request.url());
      if (pathname === CREATE_PLAN_PATH) createBodies.push(request.postData() ?? "");
      else if (activationPathPattern.test(pathname)) activationPaths.push(pathname);
    });

    // ONLY the activation is blocked. The create must genuinely succeed, or this proves a refused
    // create — which is `refused`, a different state with a different vocabulary, and the exact
    // collapse the five-state machine exists to prevent.
    let blockActivation = true;
    let resumeActivation: (() => void) | null = null;
    let delayInFlight = true;
    await page.route(
      (url) => activationPathPattern.test(url.pathname),
      async (route) => {
        if (blockActivation) {
          if (delayInFlight) {
            await new Promise<void>((resolve) => {
              resumeActivation = resolve;
            });
          }
          return route.abort("failed");
        }
        return route.continue();
      },
    );

    await openWizard(page);
    await completeAgreement(page);
    await choosePathway(page);
    await completePersonalisation(page);
    await page.getByLabel("Day the patient was discharged").fill(todayCalendarDay());
    await expect(page.getByTestId("caring-contacts-activation-schedule-summary")).toBeVisible();

    // Initial activation: verify control is enabled, then click to send create and delay activation in-flight
    await page.locator('[data-testid="workspace-overlay-trigger"][data-overlay-trigger="final-activation"]').click();
    const action = page.getByTestId("workspace-overlay-action");
    await expect(action).toBeVisible();
    await expect(action).not.toHaveAttribute("aria-disabled", "true");
    await action.click();

    // While the activation write is in-flight or delayed, the commit control is disabled
    const inFlightTrigger = page.locator(
      '[data-testid="workspace-overlay-trigger"][data-overlay-trigger="final-activation"]',
    );
    await inFlightTrigger.click();
    const inFlightAction = page.getByTestId("workspace-overlay-action");
    await expect(inFlightAction).toBeVisible();
    await expect(inFlightAction).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");

    // Release delayed activation write to abort and settle into created-not-started
    delayInFlight = false;
    if (resumeActivation) (resumeActivation as () => void)();

    // THE MIDDLE STATE, as the screen actually renders it: the plan exists, it has not started, and
    // both the named statement and the live status say so.
    const notStarted = page.getByRole("group", {
      name: "The plan was created, and the request to start it did not arrive",
    });
    await expect(notStarted).toBeVisible();
    await expect(notStarted).toContainText("The plan was created");
    await expect(
      page.getByText(
        "The plan was created and has not started. This sign-up is still on this computer, so confirming again finishes the same plan.",
      ),
    ).toBeVisible();

    expect(createBodies).toHaveLength(1);
    expect(activationPaths).toHaveLength(1);
    const firstCreate = JSON.parse(createBodies[0]) as { planId: string; idempotencyKey: string };
    expect(firstCreate.idempotencyKey, "the create carried no idempotency key").toBeTruthy();
    expect(firstCreate.planId, "the create did not name a plan id").toBeTruthy();
    expect(activationPaths[0]).toBe(`${CREATE_PLAN_PATH}/${encodeURIComponent(firstCreate.planId)}`);

    // The draft is KEPT in this state — it holds the plan id and both keys, which is the only thing
    // that makes the next press a retry rather than a duplicate.
    const heldDraft = await page.evaluate((key) => window.sessionStorage.getItem(key), PLAN_DRAFT_STORAGE_KEY);
    expect(heldDraft, "the half-done state discarded the draft").toContain(firstCreate.planId);

    blockActivation = false;
    await confirmActivation(page);

    // THE SAME PLAN, FINISHED. Not a second one: the second create carries a byte-identical body, so
    // it is a replay of the first under the same idempotency key, and the plan the screen navigates
    // to is the one the first press created.
    await expect(page).toHaveURL(
      `${seededBaseUrl}/caring-contacts/patients/${SEEDED_PATIENT_ID}?plan=${encodeURIComponent(firstCreate.planId)}`,
    );
    expect(createBodies).toHaveLength(2);
    expect(createBodies[1]).toBe(createBodies[0]);
    expect(activationPaths).toHaveLength(2);
    expect(activationPaths[1]).toBe(activationPaths[0]);

    // And the patient's own screen reads back that one plan, by the id the first press minted.
    const summary = page.getByTestId("caring-contacts-plan-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText(firstCreate.planId);

    // Both writes are confirmed, so — and only so — the draft is gone.
    const clearedDraft = await page.evaluate((key) => window.sessionStorage.getItem(key), PLAN_DRAFT_STORAGE_KEY);
    expect(clearedDraft, "a finished sign-up left the patient's details in tab storage").toBeNull();
  });
});
