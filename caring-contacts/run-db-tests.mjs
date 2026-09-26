#!/usr/bin/env node
// caring-contacts/run-db-tests.mjs
//
// Runs the caring-contact database suites -- the migration/row-level-security proofs and the
// shared repository contract driven against the Postgres store -- against a real Postgres named
// by CARING_CONTACTS_DATABASE_URL.
//
// It never skips. A missing variable is a hard failure naming the variable, because a suite that
// quietly passes when the database is absent is a check that cannot fail: the row-level security
// this schema exists to prove would then be unproven and reported green.
//
// The database is a local, disposable container. It is NOT the repository's live Supabase
// project, and nothing here touches a hosted service. Two controls keep it that way:
//   - the URL must name a loopback host (127.0.0.1, ::1 or localhost), or this runner refuses;
//   - the offline test environment applied by scripts/run-vitest.mjs blanks the variable unless
//     CARING_CONTACTS_DB_TESTS=1 is set, which only this runner sets. A plain `npm run test` in a
//     shell that still exports the URL therefore never collects the destructive project.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  CARING_CONTACTS_DATABASE_URL_KEY,
  CARING_CONTACTS_DB_TESTS_OPT_IN,
  caringContactsDatabaseHostProblem,
} from "../scripts/test-environment.mjs";

const VARIABLE = CARING_CONTACTS_DATABASE_URL_KEY;
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Decide whether the suites may run against `env`, and with which child environment.
 * Returns `{ error }` when they may not, so the caller can print and exit 1.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ error: string, env?: undefined } | { error?: undefined, env: Record<string, string | undefined> }}
 */
export function caringContactsDbRunPlan(env) {
  const url = env[VARIABLE];
  if (typeof url !== "string" || url.trim() === "") {
    return {
      error: [
        `${VARIABLE} is not set, so the caring-contact database suites cannot run.`,
        "They are never skipped: row-level security is the control that stops one hospital team",
        "seeing another team's patients, and it is only proven against a real database.",
        "",
        "Start a disposable local Postgres and point the variable at it, for example:",
        "  docker run --rm -d --name caring-contacts-pg -e POSTGRES_PASSWORD=caring-contacts-local -p 54329:5432 postgres:17",
        `  export ${VARIABLE}=postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres`,
        "",
      ].join("\n"),
    };
  }
  const hostProblem = caringContactsDatabaseHostProblem(url);
  if (hostProblem) return { error: `${hostProblem}\n` };
  return { env: { ...env, [CARING_CONTACTS_DB_TESTS_OPT_IN]: "1" } };
}

function main() {
  const plan = caringContactsDbRunPlan(process.env);
  if (plan.error) {
    process.stderr.write(plan.error);
    process.exit(1);
  }

  const child = spawn(
    process.execPath,
    [
      path.join(projectRoot, "scripts", "run-vitest.mjs"),
      "run",
      "--project=caring-contacts-db",
      ...process.argv.slice(2),
    ],
    { cwd: projectRoot, env: plan.env, stdio: "inherit" },
  );
  child.on("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  });
  child.on("close", (status, signal) => process.exit(status === null ? (signal ? 1 : 0) : status));
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) main();
