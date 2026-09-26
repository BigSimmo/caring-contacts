#!/usr/bin/env node
// Standalone extract: a thin stand-in for PsychSift's scripts/run-vitest.mjs. It runs Vitest with
// the arguments given, in the same offline environment the original applies: provider credentials
// are blanked, and CARING_CONTACTS_DATABASE_URL is blanked unless caring-contacts/run-db-tests.mjs
// opted in with CARING_CONTACTS_DB_TESTS=1 (and even then only a loopback host is accepted). So a
// plain `npm test` in a shell that still exports the database URL never collects the database
// suites, which drop and recreate the caring_contacts schema (see vitest.config.mts).
// PsychSift's run lock, gate receipts and reporter validation are not included.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { offlineTestEnvironment } from "./test-environment.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vitestBin = path.join(projectRoot, "node_modules", "vitest", "vitest.mjs");

let environment;
try {
  environment = offlineTestEnvironment(process.env, { NODE_ENV: "test" });
} catch (error) {
  console.error(`[run-vitest] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const child = spawn(process.execPath, [vitestBin, ...process.argv.slice(2)], {
  cwd: projectRoot,
  stdio: "inherit",
  env: environment,
});
child.on("error", (error) => {
  console.error(`[run-vitest] ${error.message}`);
  process.exit(1);
});
child.on("close", (status, signal) => process.exit(status === null ? (signal ? 1 : 0) : status));
