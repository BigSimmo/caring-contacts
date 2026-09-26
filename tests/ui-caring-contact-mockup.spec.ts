import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test, type Locator, type Page } from "playwright/test";

const base = "/mockups/caring-contacts";
const routes = {
  today: base,
  patients: `${base}/patients`,
  patient: `${base}/patients/SYN-PATIENT-001`,
  agreement: `${base}/plans/new?stage=agreement`,
  pathway: `${base}/plans/new?stage=pathway`,
  personalisation: `${base}/plans/new?stage=personalisation`,
  review: `${base}/plans/new?stage=review`,
  plan: `${base}/plans/SYN-PLAN-001`,
  schedule: `${base}/schedule?date=2026-08-15`,
  contact: `${base}/contacts/SYN-CONTACT-004`,
  templates: `${base}/templates`,
  team: `${base}/team`,
  guidance: `${base}/guidance`,
  reports: `${base}/reports`,
  states: `${base}/system-states`,
} as const;

const requiredWidths = [320, 390, 430, 768, 1024, 1440, 1920] as const;
const captureEvidence = process.env.CARING_CONTACT_CAPTURE_EVIDENCE === "1";
const captureDirectory = resolve(process.cwd(), ".local", "caring-contact-linked-mockup", "atlas");

const overlayMatrix = [
  ["verify-identity", "Verify identity before changing patient", "full-screen-stage", "dialog"],
  ["change-patient", "Change selected patient", "full-screen-stage", "dialog"],
  ["pathway-preview", "Preview governed pathway", "full-screen-stage", "inspection-drawer"],
  ["message-preview", "Preview exact patient-visible message", "full-screen-stage", "inspection-drawer"],
  ["communication-preference", "Communication preference", "bottom-sheet", "dialog"],
  ["adjust-date-time", "Adjust contact time", "bottom-sheet", "dialog"],
  ["outside-window-warning", "Outside approved sending window", "bottom-sheet", "dialog"],
  ["save-draft", "Save activation draft", "bottom-sheet", "dialog"],
  ["discard-changes", "Discard unsaved changes", "bottom-sheet", "dialog"],
  ["final-activation", "Final activation assurance", "full-screen-stage", "dialog"],
  ["activation-success", "Plan activation recorded", "bottom-sheet", "dialog"],
  ["pause", "Pause caring-contact plan", "bottom-sheet", "dialog"],
  ["withdrawal", "Record patient-requested withdrawal", "full-screen-stage", "dialog"],
  ["reassignment", "Reassign plan coordinator", "bottom-sheet", "dialog"],
  ["delivery-detail", "Delivery transport detail", "full-screen-stage", "inspection-drawer"],
  ["resolve-failed-delivery", "Resolve permanent delivery failure", "bottom-sheet", "dialog"],
  ["contact-changed-block", "Contact destination changed", "bottom-sheet", "dialog"],
  ["template-changed-retired", "Governed template is no longer current", "full-screen-stage", "dialog"],
  ["session-expiry", "Session expired", "session-gate", "session-gate"],
  ["offline-banner", "Offline operation unavailable", "status-banner", "status-banner"],
  ["recoverable-error", "Operational records could not be loaded", "bottom-sheet", "dialog"],
  ["permission-unavailable", "Permission unavailable", "bottom-sheet", "dialog"],
  ["team-switcher", "Switch active team", "bottom-sheet", "dialog"],
  ["draft-version-conflict", "Resolve draft version conflict", "full-screen-stage", "dialog"],
] as const;

async function gotoRoute(page: Page, route: string, heading?: string) {
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("caring-contact-synthetic-marker").first()).toHaveAttribute(
    "title",
    "Synthetic prototype — fictional data only",
    { timeout: 15_000 },
  );
  if (heading) await expect(page.getByRole("heading", { level: 1, name: heading, exact: true })).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth ?? 0) - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(2);
}

async function expectPhoneDockClearance(page: Page, control: Locator) {
  if (page.viewportSize()!.width >= 768) return;
  await control.evaluate((element) => element.scrollIntoView({ block: "center" }));
  const [controlBox, dockBox] = await Promise.all([
    control.boundingBox(),
    page.getByRole("navigation", { name: "Phone workspace" }).boundingBox(),
  ]);
  expect(controlBox).not.toBeNull();
  expect(dockBox).not.toBeNull();
  expect(controlBox!.y + controlBox!.height).toBeLessThanOrEqual(dockBox!.y + 1);
}

async function expectOverlayGeometry(page: Page, surface: Locator, modality: string) {
  const box = await surface.boundingBox();
  expect(box).not.toBeNull();
  const width = page.viewportSize()!.width;
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  if (width < 768 && (modality === "full-screen-stage" || modality === "session-gate")) {
    expect(box!.width).toBeGreaterThanOrEqual(width - 2);
    expect(box!.height).toBeGreaterThanOrEqual(760);
  }
  if (width >= 768 && modality === "inspection-drawer") {
    expect(box!.width).toBeLessThanOrEqual(width * 0.56);
    expect(box!.x + box!.width).toBeGreaterThanOrEqual(width - 2);
    expect(box!.height).toBeGreaterThanOrEqual(900);
  }
  if (width >= 768 && modality === "dialog") expect(box!.width).toBeLessThanOrEqual(640);
}

test.describe("@mockup Caring Contact linked prototype", () => {
  test("all major routes are directly reconstructable", async ({ page }) => {
    const routeHeadings = [
      [routes.today, "Today"],
      [routes.patients, "Patients"],
      [routes.patient, "Patient overview"],
      [routes.agreement, "Patient and agreement"],
      [routes.pathway, "Pathway selection"],
      [routes.personalisation, "Personalisation"],
      [routes.review, "Review and activation"],
      [routes.plan, "Plan and contact detail"],
      [routes.schedule, "Schedule"],
      [routes.contact, "Contact and delivery exception"],
      [routes.templates, "Governed templates"],
      [routes.team, "Team"],
      [routes.guidance, "Guidance"],
      [routes.reports, "Reports"],
      [routes.states, "Component and system states"],
    ] as const;
    for (const [route, heading] of routeHeadings) {
      await gotoRoute(page, route, heading);
      await expectNoHorizontalOverflow(page);
    }
  });

  test("repository chrome and content reflow at all seven target widths", async ({ page }) => {
    for (const width of requiredWidths) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoRoute(page, routes.today, "Today");
      const phoneDock = page.getByRole("navigation", { name: "Phone workspace" });
      const desktopRail = page.locator("aside").first();
      if (width < 768) {
        await expect(phoneDock).toBeVisible();
        await expect(desktopRail).toBeHidden();
        await expectPhoneDockClearance(page, page.getByRole("button", { name: "Review Rowan Sample plan setup" }));
      } else {
        await expect(phoneDock).toBeHidden();
        await expect(desktopRail).toBeVisible();
      }
      await expectNoHorizontalOverflow(page);
    }
  });

  test("wide compositions split and compact team actions never crush the heading", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, routes.team, "Team");
    const compactHeading = await page.getByRole("heading", { name: "Team ownership" }).boundingBox();
    const compactAction = await page.getByRole("button", { name: "Reassign work" }).boundingBox();
    expect(compactHeading).not.toBeNull();
    expect(compactAction).not.toBeNull();
    expect(compactAction!.y).toBeGreaterThanOrEqual(compactHeading!.y + compactHeading!.height);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await gotoRoute(page, routes.today, "Today");
    const referral = await page.getByRole("heading", { name: "Referrals to review" }).boundingBox();
    const action = await page.getByRole("heading", { name: "Needs action" }).boundingBox();
    expect(referral).not.toBeNull();
    expect(action).not.toBeNull();
    expect(action!.x).toBeGreaterThan(referral!.x + referral!.width);

    await gotoRoute(page, routes.plan, "Plan and contact detail");
    const summary = await page.getByRole("heading", { name: "Plan summary" }).boundingBox();
    const timeline = await page.getByRole("heading", { name: "Plan timeline" }).boundingBox();
    const planActions = await page.getByRole("heading", { name: "Plan actions" }).boundingBox();
    expect(summary).not.toBeNull();
    expect(timeline).not.toBeNull();
    expect(planActions).not.toBeNull();
    expect(timeline!.x).toBeGreaterThan(summary!.x + summary!.width);
    expect(planActions!.x).toBeGreaterThan(timeline!.x + timeline!.width);

    await gotoRoute(page, routes.templates, "Governed templates");
    const library = await page.getByRole("heading", { name: "Version library" }).boundingBox();
    const detail = await page.getByRole("heading", { name: "Example twelve-month pathway" }).boundingBox();
    expect(library).not.toBeNull();
    expect(detail).not.toBeNull();
    expect(detail!.x).toBeGreaterThan(library!.x + library!.width);
    await expectNoHorizontalOverflow(page);
  });

  for (const width of [390, 1440] as const) {
    test(`linked activation, history and protected state are coherent at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoRoute(page, routes.today, "Today");
      await page.getByRole("button", { name: "Review Rowan Sample plan setup" }).click();
      await expect(page).toHaveURL(new RegExp(`${base}/plans/new\\?stage=agreement$`));
      await expect(page.getByRole("heading", { level: 1, name: "Patient and agreement" })).toBeFocused();

      await page.getByRole("button", { name: "Continue to pathway selection" }).click();
      await page.getByRole("button", { name: "Preview pathway" }).click();
      await expect(page).toHaveURL(/stage=pathway&overlay=pathway-preview$/);
      await expect(page.getByRole("dialog", { name: "Preview governed pathway" })).toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/stage=pathway$/);
      await page.goForward();
      await expect(page.getByRole("dialog", { name: "Preview governed pathway" })).toBeVisible();
      await page.keyboard.press("Escape");

      await page.getByRole("button", { name: "Continue to personalisation" }).click();
      await expect(page.getByRole("radio", { name: /Morning/ })).toBeChecked();
      await page.getByRole("button", { name: "Continue to review and activation" }).click();
      const activate = page.getByRole("button", { name: "Activate 10-contact plan" });
      await expectPhoneDockClearance(page, activate);
      await activate.click();
      const confirmation = page.getByRole("dialog", { name: "Final activation assurance" });
      await expect(confirmation).toContainText("synthetic action records review only");
      await confirmation.getByRole("button", { name: "Confirm activation review" }).click();
      await expect(page.getByRole("dialog", { name: "Plan activation recorded" })).toBeVisible();
      await page.getByRole("button", { name: "View activated plan" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Patient overview" })).toBeFocused();
      await expect(page.getByText(/in-memory synthetic prototype/i).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
    });
  }

  test("Schedule day choice stays in browser history", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, routes.schedule, "Schedule");
    await page.getByRole("button", { name: "Sun 16 Aug, 3 scheduled contacts" }).click();
    await expect(page).toHaveURL(/date=2026-08-16$/);
    await expect(page.getByRole("heading", { level: 2, name: "Sunday 16 August 2026" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/date=2026-08-15$/);
  });

  for (const width of [390, 1440] as const) {
    test(`all 24 governed overlays honour modality, dismissal and focus contracts at ${width}px`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoRoute(page, routes.states, "Component and system states");
      for (const [id, title, phoneModality, desktopModality] of overlayMatrix) {
        const trigger = page.locator(`[data-overlay-trigger="${id}"]`);
        await trigger.click();
        await expect(page).toHaveURL(new RegExp(`overlay=${id}`));
        const surface =
          id === "offline-banner"
            ? page.getByRole("status", { name: "Offline status" })
            : id === "session-expiry"
              ? page.getByRole("dialog", { name: "Session expired" })
              : page.getByTestId(`caring-contact-overlay-${id}`);
        await expect(surface).toBeVisible();
        const modality = width < 768 ? phoneModality : desktopModality;
        if (id !== "offline-banner") {
          await expect(surface.getByTestId("overlay-specific-content")).toHaveAttribute(
            "data-overlay-modality",
            modality,
          );
          await expectOverlayGeometry(page, surface, modality);
        }
        if (id === "session-expiry") {
          await page.keyboard.press("Escape");
          await expect(surface).toBeVisible();
          await surface.getByRole("button", { name: "Sign in again" }).click();
        } else if (id === "offline-banner") {
          await expect(page.getByRole("heading", { name: title })).toBeVisible();
          await surface.getByRole("button", { name: "Try reconnecting" }).click();
        } else {
          await page.keyboard.press("Escape");
        }
        await expect(page).not.toHaveURL(new RegExp(`overlay=${id}`));
        if (id !== "offline-banner") await expect(trigger).toBeFocused();
      }
    });
  }

  test("an open mutation fails closed when connectivity changes before confirmation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, `${routes.plan}?overlay=pause`, "Plan and contact detail");
    const dialog = page.getByRole("dialog", { name: "Pause caring-contact plan" });
    const action = dialog.getByRole("button", { name: "Pause future contacts" });
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await expect(action).toHaveAttribute("aria-disabled", "true");
    await expect(dialog).toContainText("offline");
    await action.click({ force: true });
    await expect(dialog).toBeVisible();
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect(action).not.toHaveAttribute("aria-disabled");
    await action.click();
    await expect(page.getByText("Plan paused in synthetic prototype", { exact: false }).first()).toBeVisible();
  });

  test("session, permission and version scenarios remain explicit and non-destructive", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoRoute(page, `${routes.plan}?overlay=pause&scenario=permission-unavailable`, "Plan and contact detail");
    await expect(page.getByRole("button", { name: "Pause future contacts" })).toHaveAttribute("aria-disabled", "true");
    await gotoRoute(
      page,
      `${routes.review}&overlay=final-activation&scenario=version-conflict`,
      "Review and activation",
    );
    await expect(page.getByRole("button", { name: "Confirm activation review" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await gotoRoute(
      page,
      `${routes.states}?scenario=expired-session&overlay=session-expiry`,
      "Component and system states",
    );
    const gate = page.getByRole("dialog", { name: "Session expired" });
    await page.keyboard.press("Escape");
    await expect(gate).toBeVisible();
  });

  test("dark, reduced-motion, forced-colour and 400%-equivalent reflow retain a usable focus path", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce", forcedColors: "active" });
    await gotoRoute(page, routes.today, "Today");
    const review = page.getByRole("button", { name: "Review Rowan Sample plan setup" });
    await review.focus();
    await expect(review).toBeFocused();
    expect(await review.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe("none");
    await expectNoHorizontalOverflow(page);
    await gotoRoute(page, routes.plan, "Plan and contact detail");
    await expectNoHorizontalOverflow(page);
  });

  test("refresh resets local mutations while protected deep links remain coherent", async ({ page }) => {
    await gotoRoute(page, `${routes.plan}?overlay=pause`, "Plan and contact detail");
    const planDetail = page.getByTestId("caring-contact-screen-plan-detail");
    const planStatusChip = planDetail.locator('[data-testid="chip"][data-appearance="status"]');
    await page.getByRole("button", { name: "Pause future contacts" }).click();
    await expect(planStatusChip.filter({ hasText: "Paused" })).toBeVisible();
    await expect(page).not.toHaveURL(/overlay=pause/);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(planStatusChip.filter({ hasText: "Active" })).toBeVisible();
    await gotoRoute(page, routes.contact, "Contact and delivery exception");
    await expect(page.getByRole("dialog", { name: "Permanent delivery exception" })).toBeVisible();
  });

  async function capture(
    page: Page,
    name: string,
    route: string,
    scenario: string,
    target: Locator,
    manifest: object[],
  ) {
    await page.evaluate(() => {
      document.documentElement.setAttribute("data-caring-contact-capture", "true");
      let style = document.querySelector<HTMLStyleElement>("#caring-contact-capture-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "caring-contact-capture-style";
        style.textContent =
          'html[data-caring-contact-capture="true"] nav[aria-label="Phone workspace"] { display: none !important; }';
        document.head.append(style);
      }
    });
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    await target.screenshot({ path: resolve(captureDirectory, name), animations: "disabled" });
    await page.evaluate(() => document.documentElement.removeAttribute("data-caring-contact-capture"));
    manifest.push({
      file: name,
      route,
      viewport: page.viewportSize(),
      scenario,
      dimensions: { width: Math.round(box!.width), height: Math.round(box!.height) },
    });
  }

  test("captures the deterministic 44-image handoff atlas", async ({ page }) => {
    test.skip(!captureEvidence, "Set CARING_CONTACT_CAPTURE_EVIDENCE=1 to refresh the linked prototype atlas.");
    test.setTimeout(360_000);
    rmSync(captureDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    mkdirSync(captureDirectory, { recursive: true });
    const manifest: object[] = [];
    const majorPages = [
      ["01-today", routes.today, "Today"],
      ["02-patients", routes.patients, "Patients"],
      ["03-patient-overview", routes.patient, "Patient overview"],
      ["04-patient-agreement", routes.agreement, "Patient and agreement"],
      ["05-pathway-selection", routes.pathway, "Pathway selection"],
      ["06-personalisation", routes.personalisation, "Personalisation"],
      ["07-review-activation", routes.review, "Review and activation"],
      ["08-plan-detail", routes.plan, "Plan and contact detail"],
      ["09-schedule", routes.schedule, "Schedule"],
      ["10-delivery-exception", routes.contact, "Contact and delivery exception"],
      ["11-templates", routes.templates, "Governed templates"],
      ["12-team", routes.team, "Team"],
      ["13-guidance", routes.guidance, "Guidance"],
      ["14-reports", routes.reports, "Reports"],
    ] as const;
    const overlayCaptures = [
      ["pathway-preview", `${routes.pathway}&overlay=pathway-preview`],
      ["message-preview", `${routes.personalisation}&overlay=message-preview`],
      ["final-activation", `${routes.review}&overlay=final-activation`],
      ["withdrawal", `${routes.plan}?overlay=withdrawal`],
      ["delivery-exception", `${routes.plan}?overlay=delivery-detail`],
      ["session-expiry", `${routes.states}?scenario=expired-session&overlay=session-expiry`],
      ["offline", `${routes.states}?scenario=offline&overlay=offline-banner`],
      ["version-conflict", `${routes.review}&scenario=version-conflict&overlay=draft-version-conflict`],
    ] as const;

    for (const [device, width, height] of [
      ["phone", 390, 844],
      ["desktop", 1440, 1000],
    ] as const) {
      await page.setViewportSize({ width, height });
      for (const [name, route, heading] of majorPages) {
        if (device === "phone" && name === "10-delivery-exception") {
          await page.setViewportSize({ width, height: 1200 });
        }
        await gotoRoute(page, route, heading);
        const target =
          name === "10-delivery-exception"
            ? page.getByRole("dialog", { name: "Permanent delivery exception" })
            : page.locator("main").last();
        await capture(page, `${device}-${name}.png`, route, "normal", target, manifest);
        if (device === "phone" && name === "10-delivery-exception") {
          await page.setViewportSize({ width, height });
        }
      }
      for (const [name, route] of overlayCaptures) {
        await gotoRoute(page, route);
        const target =
          name === "offline"
            ? page.locator('[data-overlay-id="offline-banner"]')
            : name === "session-expiry"
              ? page.getByRole("dialog", { name: "Session expired" })
              : page.locator('[data-testid^="caring-contact-overlay-"]');
        await capture(page, `${device}-overlay-${name}.png`, route, name, target, manifest);
      }
    }
    const images = readdirSync(captureDirectory).filter((name) => name.endsWith(".png"));
    expect(images).toHaveLength(44);
    writeFileSync(
      resolve(captureDirectory, "manifest.json"),
      `${JSON.stringify(
        {
          sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
          generatedAt: new Date().toISOString(),
          captures: manifest,
        },
        null,
        2,
      )}\n`,
    );
  });
});
