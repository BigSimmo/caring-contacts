import { defineConfig, devices } from "playwright/test";

// Standalone extract of the Caring Contacts parts of PsychSift's playwright.config.ts.
// `npm run test:e2e` builds the app, starts both servers and sets these for you. To run
// `npx playwright test` by hand instead, start the servers yourself and point these at them:
//   PLAYWRIGHT_BASE_URL         the ordinary server (empty workspace + design prototypes)
//   PLAYWRIGHT_SEEDED_BASE_URL  a second server started with CARING_CONTACTS_DEMO_SEED=on
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const seededBaseURL = process.env.PLAYWRIGHT_SEEDED_BASE_URL;
const chromiumExecutablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
const chrome = {
  ...devices["Desktop Chrome"],
  ...(chromiumExecutablePath ? { launchOptions: { executablePath: chromiumExecutablePath } } : {}),
};
const mockupTag = /@mockup/;

export default defineConfig({
  testDir: "./tests",
  testMatch: /ui-caring-contact.*\.spec\.ts/,
  timeout: 60_000,
  retries: 0,
  forbidOnly: !!process.env.CI,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    contextOptions: { reducedMotion: "reduce" },
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testMatch: /ui-caring-contacts-workspace\.spec\.ts/,
      grepInvert: mockupTag,
      use: chrome,
    },
    {
      name: "chromium-mockups",
      testMatch: /ui-caring-contact-mockup\.spec\.ts/,
      grep: mockupTag,
      use: chrome,
    },
    {
      name: "chromium-caring-contacts-seeded",
      testMatch: /ui-caring-contacts-(activation|populated)\.spec\.ts/,
      grepInvert: mockupTag,
      use: { ...chrome, baseURL: seededBaseURL ?? baseURL },
    },
  ],
});
