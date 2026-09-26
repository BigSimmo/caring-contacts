const providerEnvironmentKeys = Object.freeze([
  "OPENAI_API_KEY",
  "OPENAI_ORG_ID",
  "OPENAI_PROJECT_ID",
  "OPENAI_BASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_PROJECT_NAME",
  "SUPABASE_STAGING_PROJECT_REF",
  "SUPABASE_STAGING_PROJECT_NAME",
  "DATABASE_URL",
  "POSTGRES_PASSWORD",
  "E2E_AUTH_ENABLED",
  "E2E_USER_EMAIL",
  "E2E_USER_PASSWORD",
  "SENTRY_AUTH_TOKEN",
  // Public client DSN is still a live monitoring destination — scrub it too so
  // Playwright/Lighthouse production builds cannot bake a real browser DSN.
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_DSN",
  "ALLOW_PROVIDER_TESTS",
]);

const offlineUrlValues = Object.freeze({
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_URL: "http://127.0.0.1:1",
  SUPABASE_DB_URL: "postgresql://offline:offline@127.0.0.1:1/offline",
  DATABASE_URL: "postgresql://offline:offline@127.0.0.1:1/offline",
});

// Feature flags / sampling, not credentials: force them off in offline wrappers
// without joining the credential inventory (which would also demand setup/raw-env
// scrubbing for names that never carry a secret). Applied to every consumer of
// offlineTestEnvironment (Vitest, Playwright, Lighthouse, CLS) by design — the
// offline contract is provider-free, so default-on Sentry log/trace behaviour
// must be opted into via an explicit test argument, not the ambient environment.
const offlineSentryControlFlags = Object.freeze({
  SENTRY_ENABLE_LOGS: "false",
  SENTRY_SEND_TEST_LOG: "false",
  // Belt-and-suspenders with blank DSNs: keep DB/perf tracing off even if a
  // future change leaves a truthy DSN in the offline environment.
  SENTRY_TRACES_SAMPLE_RATE: "0",
});

// The caring-contact database suites (`vitest.config.mts` project `caring-contacts-db`)
// are collected whenever this variable is non-empty, and their `beforeAll` drops and
// recreates the `caring_contacts` schema on whatever host it names. A developer who
// exported it for `npm run caring-contacts:db:test` must not turn a later plain
// `npm run test` into a destructive database run, so the offline environment blanks
// it unless the explicit runner (`caring-contacts/run-db-tests.mjs`) opted in — and
// even then only a loopback host is accepted.
export const CARING_CONTACTS_DATABASE_URL_KEY = "CARING_CONTACTS_DATABASE_URL";
export const CARING_CONTACTS_DB_TESTS_OPT_IN = "CARING_CONTACTS_DB_TESTS";

const LOOPBACK_HOSTNAMES = new Set(["localhost", "::1", "[::1]"]);

/**
 * Why the caring-contact database URL may not be used, or null when its host is loopback.
 * Only 127.0.0.0/8, ::1 and `localhost` qualify; a service name, LAN address or hosted
 * Postgres is refused so the schema drop can never reach a shared database.
 *
 * @param {string | undefined} url
 * @returns {string | null}
 */
export function caringContactsDatabaseHostProblem(url) {
  let hostname = "";
  try {
    hostname = new URL(String(url ?? "").trim()).hostname.toLowerCase();
  } catch {
    return `${CARING_CONTACTS_DATABASE_URL_KEY} is not a parseable URL; the caring-contact database suites only run against a loopback host such as 127.0.0.1.`;
  }
  const loopback = LOOPBACK_HOSTNAMES.has(hostname) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
  if (loopback) return null;
  return (
    `${CARING_CONTACTS_DATABASE_URL_KEY} names host "${hostname || "(none)"}", which is not a loopback address. ` +
    "The caring-contact database suites drop and recreate the caring_contacts schema, so they only run " +
    "against a disposable local Postgres on 127.0.0.1, ::1 or localhost — never a shared, staging or hosted database."
  );
}

/**
 * @param {Record<string, string | undefined>} source
 * @param {Record<string, string | undefined>} overrides
 */
export function offlineTestEnvironment(source = process.env, overrides = {}) {
  const environment = { ...source };
  if (environment[CARING_CONTACTS_DB_TESTS_OPT_IN] === "1") {
    const problem = caringContactsDatabaseHostProblem(environment[CARING_CONTACTS_DATABASE_URL_KEY]);
    if (problem) throw new Error(problem);
  } else {
    environment[CARING_CONTACTS_DATABASE_URL_KEY] = "";
  }
  // Explicit values both scrub inherited secrets and prevent Next/Vite from
  // repopulating the same names from a repository-local env file. URL-shaped
  // settings use inert loopback values so the runtime env schema still parses.
  //
  // Sentry DSNs are blanked (not deleted or faked): an absent key lets Next
  // reload a live DSN from `.env.local` during Playwright/Lighthouse production
  // starts, and a truthy inert URL keeps app Sentry gates enabled. Empty string
  // stays falsy for `SENTRY_DSN?.trim()` and is coerced to unset by optionalUrlEnv
  // in `src/lib/env.ts`.
  for (const key of providerEnvironmentKeys) {
    environment[key] = offlineUrlValues[key] ?? "";
  }
  Object.assign(environment, offlineSentryControlFlags);

  return {
    ...environment,
    RAG_PROVIDER_MODE: "offline",
    NEXT_PUBLIC_DEMO_MODE: "true",
    ...overrides,
  };
}

/** @param {Record<string, string | undefined>} environment */
export function requireProviderTestPermission(environment = process.env) {
  if (environment.ALLOW_PROVIDER_TESTS !== "true") {
    throw new Error(
      "Live provider tests are disabled. Set ALLOW_PROVIDER_TESTS=true only after explicit provider-test approval.",
    );
  }
}

/** @param {Record<string, string | undefined>} environment */
export function providerFreeCloudLiveTestGap(environment = process.env) {
  const providerFree =
    environment.ALLOW_PROVIDER_TESTS === "true" &&
    environment.CODEX_CLOUD === "1" &&
    (environment.CODEX_CLOUD_ACCESS_PROFILE ?? "offline") === "offline";
  if (!providerFree) return null;
  return (
    "Live provider test capability gap: ALLOW_PROVIDER_TESTS is authorized, but agent-phase provider " +
    "credentials are intentionally unavailable in CODEX_CLOUD_ACCESS_PROFILE=offline. Run this check " +
    "locally/operator-side or in an explicitly provisioned connected Cloud profile."
  );
}

export { offlineUrlValues, offlineSentryControlFlags, providerEnvironmentKeys };
