// Standalone extract: PsychSift's gate-receipt cache (scripts/gate-receipts.mjs) is not part of this
// copy, so its `OUTCOME_AFFECTING_ENV_VARS` import and the one case that read it ("keys gate
// receipts on the database variable ...") are dropped: there are no gate receipts here to key.
// Every other case is unchanged. None of them relied on PsychSift's test runner applying
// `offlineTestEnvironment` -- they call it directly -- but this copy's scripts/run-vitest.mjs
// applies it too, as the original runner does.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { caringContactsDbRunPlan } from "../caring-contacts/run-db-tests.mjs";
import {
  CARING_CONTACTS_DATABASE_URL_KEY,
  CARING_CONTACTS_DB_TESTS_OPT_IN,
  caringContactsDatabaseHostProblem,
  offlineTestEnvironment,
} from "../scripts/test-environment.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOOPBACK_URL = "postgres://postgres:caring-contacts-local@127.0.0.1:54329/postgres";
const REMOTE_URL = "postgres://postgres:secret@db.example.supabase.co:5432/postgres";

// The caring-contact database suites drop and recreate the `caring_contacts` schema on
// whatever host CARING_CONTACTS_DATABASE_URL names. A plain `npm run test` must therefore
// never see the variable, and the explicit runner must only ever point at a loopback host.
describe("caring-contacts database suites stay out of the default offline test run", () => {
  it("scrubs CARING_CONTACTS_DATABASE_URL from the offline environment unless the runner opted in", () => {
    const environment: Record<string, string | undefined> = offlineTestEnvironment({
      [CARING_CONTACTS_DATABASE_URL_KEY]: LOOPBACK_URL,
    });
    // Blank, not deleted: an explicit value stops Vite/Next from repopulating the name
    // from a repository-local env file, and vitest.config.mts treats "" as "no database".
    expect(environment[CARING_CONTACTS_DATABASE_URL_KEY]).toBe("");
    expect(environment[CARING_CONTACTS_DB_TESTS_OPT_IN]).toBeUndefined();
  });

  it("keeps a loopback CARING_CONTACTS_DATABASE_URL when the explicit runner opted in", () => {
    const environment: Record<string, string | undefined> = offlineTestEnvironment({
      [CARING_CONTACTS_DATABASE_URL_KEY]: LOOPBACK_URL,
      [CARING_CONTACTS_DB_TESTS_OPT_IN]: "1",
    });
    expect(environment[CARING_CONTACTS_DATABASE_URL_KEY]).toBe(LOOPBACK_URL);
    expect(environment[CARING_CONTACTS_DB_TESTS_OPT_IN]).toBe("1");
  });

  it("refuses a non-loopback database even when the runner opted in", () => {
    expect(() =>
      offlineTestEnvironment({
        [CARING_CONTACTS_DATABASE_URL_KEY]: REMOTE_URL,
        [CARING_CONTACTS_DB_TESTS_OPT_IN]: "1",
      }),
    ).toThrow(/loopback/);
  });

  it("recognises loopback hosts and nothing else", () => {
    for (const url of [
      LOOPBACK_URL,
      "postgres://postgres@localhost:54329/postgres",
      "postgresql://postgres@[::1]:5432/postgres",
      "postgres://postgres@127.10.0.1/postgres",
    ]) {
      expect(caringContactsDatabaseHostProblem(url), url).toBeNull();
    }
    for (const url of [
      REMOTE_URL,
      "postgres://postgres@10.0.0.5:5432/postgres",
      "postgres://postgres@postgres:5432/postgres",
      "not a url",
    ]) {
      expect(caringContactsDatabaseHostProblem(url), url).toMatch(/loopback/);
    }
  });

  it("plans the explicit runner with the opt-in marker only for a loopback database", () => {
    const plan = caringContactsDbRunPlan({ PATH: "/usr/bin", [CARING_CONTACTS_DATABASE_URL_KEY]: LOOPBACK_URL });
    expect(plan.error).toBeUndefined();
    expect(plan.env?.[CARING_CONTACTS_DB_TESTS_OPT_IN]).toBe("1");
    expect(plan.env?.[CARING_CONTACTS_DATABASE_URL_KEY]).toBe(LOOPBACK_URL);
    expect(plan.env?.PATH).toBe("/usr/bin");

    expect(caringContactsDbRunPlan({}).error).toMatch(/is not set/);
    expect(caringContactsDbRunPlan({ [CARING_CONTACTS_DATABASE_URL_KEY]: REMOTE_URL }).error).toMatch(/loopback/);
  });

  it("exits before spawning Vitest when the database is not on a loopback host", () => {
    let failure: { status?: number; stderr?: string } | null = null;
    try {
      execFileSync(process.execPath, [path.join(repositoryRoot, "caring-contacts", "run-db-tests.mjs")], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: { ...process.env, [CARING_CONTACTS_DATABASE_URL_KEY]: REMOTE_URL },
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      failure = error as { status?: number; stderr?: string };
    }
    expect(failure, "the runner must refuse").not.toBeNull();
    expect(failure?.status).toBe(1);
    expect(failure?.stderr).toMatch(/loopback/);
  });
});
