#!/usr/bin/env node
// Standalone extract: runs the four Caring Contacts browser journeys the way PsychSift's
// scripts/run-playwright.mjs did, in a simplified form.
//
//   1. Builds an isolated, provider-free production app under .next-playwright/<run>/dist (the only
//      production output src/instrumentation.ts lets carry NEXT_PUBLIC_DEMO_MODE).
//   2. Starts two servers from it: an empty one, and a seeded one (CARING_CONTACTS_DEMO_SEED=on)
//      for the activation and populated journeys.
//   3. Runs `playwright test` against them, then stops both servers.
//
// Extra arguments are passed to Playwright, e.g. `npm run test:e2e -- --project=chromium`.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const playwrightBin = path.join(projectRoot, "node_modules", "playwright", "cli.js");
// A fixed folder name, so `next build` adds one stable entry to tsconfig.json instead of a new
// one per run. Set CARING_CONTACTS_E2E_RUN_ID to run two suites side by side (with a different port).
const runId = process.env.CARING_CONTACTS_E2E_RUN_ID?.trim() || "e2e";
const plainPort = Number(process.env.CARING_CONTACTS_E2E_PORT ?? 3941);
const seededPort = plainPort + 1;

const env = {
  ...process.env,
  NODE_ENV: "production",
  NEXT_TELEMETRY_DISABLED: "1",
  PLAYWRIGHT_OFFLINE_MODE: "true",
  NEXT_PUBLIC_DEMO_MODE: "true",
  NEXT_DIST_DIR: `.next-playwright/${runId}/dist`,
  CARING_CONTACTS_MOCKUPS_ENABLED: "true",
  CARING_CONTACTS_DATABASE_URL: "",
};

function run(command, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [command, ...args], {
    cwd: projectRoot,
    env: { ...env, ...extraEnv },
    stdio: "inherit",
  });
  return result.status ?? 1;
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server at ${url} did not start.`);
}

if (run(nextBin, ["build"]) !== 0) process.exit(1);

const servers = [
  spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(plainPort)], {
    cwd: projectRoot,
    env,
    stdio: "ignore",
  }),
  spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(seededPort)], {
    cwd: projectRoot,
    env: { ...env, CARING_CONTACTS_DEMO_SEED: "on" },
    stdio: "ignore",
  }),
];
const stopServers = () => servers.forEach((server) => server.kill("SIGTERM"));
process.on("exit", stopServers);

let status = 1;
try {
  await waitFor(`http://127.0.0.1:${plainPort}/caring-contacts`);
  await waitFor(`http://127.0.0.1:${seededPort}/caring-contacts`);
  status = run(playwrightBin, ["test", ...process.argv.slice(2)], {
    PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${plainPort}`,
    PLAYWRIGHT_SEEDED_BASE_URL: `http://127.0.0.1:${seededPort}`,
  });
} finally {
  stopServers();
}
process.exit(status);
