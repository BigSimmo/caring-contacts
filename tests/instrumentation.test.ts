// Standalone extract: only the "Caring Contacts live-mode boot gate" block of PsychSift's
// tests/instrumentation.test.ts is kept, with the helpers it needs. The "instrumentation boot
// guard" block tested PsychSift's Supabase, OpenAI, query-hash and no-auth checks, none of which
// exist in this copy's src/instrumentation.ts, so it is dropped. `FULLY_CONFIGURED` no longer
// stubs PsychSift's Supabase/OpenAI keys (this register() never reads them); it is just a Node.js
// production server. A new block covers the demo-mode / isolated-Playwright guard this copy's
// register() keeps from the original, which PsychSift covered in the dropped block.
import { createHmac } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

// env is read at call time, but each case still re-imports the module with fresh stubs, as the
// original did, so no module state can leak between cases.

const ENV_KEYS = [
  "NEXT_RUNTIME",
  "NODE_ENV",
  "NEXT_PUBLIC_DEMO_MODE",
  "PLAYWRIGHT_OFFLINE_MODE",
  "NEXT_DIST_DIR",
  "CARING_CONTACTS_DEMO_ENABLED",
  "CARING_CONTACTS_DATABASE_URL",
  "CARING_CONTACTS_SESSION_HMAC_SECRET",
  "CARING_CONTACTS_SESSION_ISSUER",
  "CARING_CONTACTS_OIDC_CLIENT_ID",
  "CARING_CONTACTS_OIDC_CLIENT_SECRET",
  "CARING_CONTACTS_OIDC_REDIRECT_URL",
  "CARING_CONTACTS_OIDC_ROLE_MAP",
  "CARING_CONTACTS_OIDC_TEAM_MAP",
  "CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON",
  "CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC",
  "CARING_CONTACTS_GOVERNANCE_HMAC_SECRET",
  "CARING_CONTACTS_SMS_TRANSPORT",
  "CARING_CONTACTS_TELSTRA_CLIENT_ID",
] as const;

async function loadInstrumentation(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  vi.resetModules();
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, overrides[key]);
  }
  return import("../src/instrumentation");
}

async function loadRegister(overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  const mod = await loadInstrumentation(overrides);
  return mod.register;
}

const PRODUCTION_NODE = { NEXT_RUNTIME: "nodejs", NODE_ENV: "production" } as const;

const FULLY_CONFIGURED = { ...PRODUCTION_NODE } as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe("production demo-mode and isolated Playwright guard", () => {
  it("refuses to start a production server with NEXT_PUBLIC_DEMO_MODE set", async () => {
    const register = await loadRegister({ ...PRODUCTION_NODE, NEXT_PUBLIC_DEMO_MODE: "true" });
    await expect(register()).rejects.toThrow(/NEXT_PUBLIC_DEMO_MODE is set in a production build/);
  });

  it("refuses the Playwright offline flag without an isolated build directory", async () => {
    const missing = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    await expect(missing()).rejects.toThrow(/invalid isolated Playwright offline environment/);

    const shared = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_DIST_DIR: ".next",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    await expect(shared()).rejects.toThrow(/invalid isolated Playwright offline environment/);
  });

  it("refuses an isolated Playwright build that is not in demo mode", async () => {
    const register = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_DIST_DIR: ".next-playwright/run-1/dist",
    });
    await expect(register()).rejects.toThrow(/invalid isolated Playwright offline environment/);
  });

  it("allows only the isolated demo-mode Playwright production profile", async () => {
    const register = await loadRegister({
      ...PRODUCTION_NODE,
      PLAYWRIGHT_OFFLINE_MODE: "true",
      NEXT_DIST_DIR: ".next-playwright/run-1/dist",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    await expect(register()).resolves.toBeUndefined();
  });

  it("starts a plain production server", async () => {
    const register = await loadRegister(FULLY_CONFIGURED);
    await expect(register()).resolves.toBeUndefined();
  });

  it("is a no-op outside production, even in demo mode", async () => {
    const register = await loadRegister({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "development",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    await expect(register()).resolves.toBeUndefined();
  });

  it("is a no-op on the Edge runtime", async () => {
    const register = await loadRegister({
      NEXT_RUNTIME: "edge",
      NODE_ENV: "production",
      NEXT_PUBLIC_DEMO_MODE: "true",
    });
    await expect(register()).resolves.toBeUndefined();
  });
});

/**
 * The Caring Contacts live-mode boot gate had NO test at all before this file gained the block
 * below: the MAC verification, the missing-database refusal and the attestation parse could each
 * have been weakened without a single check going red. Found while verifying an external audit
 * on 2026-09-17. Every case here was watched failing against the unpatched gate before being
 * trusted.
 *
 * `CARING_CONTACTS_DEMO_ENABLED === "false"` is what arms the gate, and it is deliberately a
 * SUPERSET of live mode: a deployment that has turned the demo off but configured nothing else
 * must still be told what it is missing rather than quietly serving a shut workspace.
 */
const GOVERNANCE_SECRET = "governance-hmac-secret";

function validAttestation(): string {
  const validUntil = new Date(Date.now() + 90 * 24 * 60 * 60 * 1_000).toISOString();
  return JSON.stringify({
    attestationVersion: "1.0.0",
    clinicalSafetyOfficer: {
      name: "Example Officer",
      ahpraRegistrationNumber: "MED0001234567",
      role: "Clinical Safety Officer",
    },
    hazardMitigations: {
      h00SafetyOfficerApproved: true,
      h04LivedExperienceReviewApproved: true,
      h05AboriginalCulturalSafetyApproved: true,
    },
    pilotScope: { validUntilIso: validUntil },
    digitalSignatureRef: "signature-reference-value",
  });
}

function macFor(raw: string): string {
  return createHmac("sha256", GOVERNANCE_SECRET).update(raw, "utf8").digest("hex");
}

/** Every live-mode requirement satisfied. Each case below removes exactly one of them. */
function liveModeEnv(attestation = validAttestation()) {
  return {
    ...FULLY_CONFIGURED,
    CARING_CONTACTS_DEMO_ENABLED: "false",
    CARING_CONTACTS_DATABASE_URL: "postgres://example.invalid/caring_contacts",
    CARING_CONTACTS_SESSION_HMAC_SECRET: "session-hmac-secret",
    CARING_CONTACTS_SESSION_ISSUER: "https://sso.example.invalid",
    CARING_CONTACTS_OIDC_CLIENT_ID: "caring-contacts",
    CARING_CONTACTS_OIDC_CLIENT_SECRET: "oidc-client-secret-value",
    CARING_CONTACTS_OIDC_REDIRECT_URL: "https://caring-contacts.example.invalid/api/caring-contacts/auth/callback",
    CARING_CONTACTS_OIDC_ROLE_MAP: JSON.stringify({ "cc-coordinators": "coordinator" }),
    CARING_CONTACTS_OIDC_TEAM_MAP: JSON.stringify({ "cc-team-north": "team-north" }),
    CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON: attestation,
    CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC: macFor(attestation),
    CARING_CONTACTS_GOVERNANCE_HMAC_SECRET: GOVERNANCE_SECRET,
  } as const;
}

describe("Caring Contacts live-mode boot gate", () => {
  it("starts when every live-mode requirement is satisfied", async () => {
    const register = await loadRegister(liveModeEnv());
    await expect(register()).resolves.toBeUndefined();
  });

  it("leaves a demo-mode deployment alone", async () => {
    // The gate is armed by the exact string "false". Demo staging must pass straight through it,
    // attestation and all, or every sovereign demo deployment would refuse to boot.
    const register = await loadRegister({ ...FULLY_CONFIGURED, CARING_CONTACTS_DEMO_ENABLED: "true" });
    await expect(register()).resolves.toBeUndefined();
  });

  it("refuses live mode with no dedicated database, so real-patient writes cannot land in memory", async () => {
    const register = await loadRegister({ ...liveModeEnv(), CARING_CONTACTS_DATABASE_URL: undefined });
    await expect(register()).rejects.toThrow(/CARING_CONTACTS_DATABASE_URL/);
  });

  it("refuses live mode with no session secret rather than serving a silently shut workspace", async () => {
    const register = await loadRegister({ ...liveModeEnv(), CARING_CONTACTS_SESSION_HMAC_SECRET: undefined });
    await expect(register()).rejects.toThrow(/CARING_CONTACTS_SESSION_HMAC_SECRET/);
  });

  it("refuses live mode when no session issuer (identity provider) is configured to mint the cookie it demands", async () => {
    // Without an issuer nobody can obtain the signed session live mode demands, so every request
    // would be refused. One refusal at boot beats a 401 per request.
    const register = await loadRegister({ ...liveModeEnv(), CARING_CONTACTS_SESSION_ISSUER: undefined });
    await expect(register()).rejects.toThrow(/no working session issuer.*CARING_CONTACTS_SESSION_ISSUER/);
  });

  it.each([
    "CARING_CONTACTS_OIDC_CLIENT_ID",
    "CARING_CONTACTS_OIDC_CLIENT_SECRET",
    "CARING_CONTACTS_OIDC_REDIRECT_URL",
    "CARING_CONTACTS_OIDC_ROLE_MAP",
    "CARING_CONTACTS_OIDC_TEAM_MAP",
  ] as const)("refuses live mode when staff sign-in is missing %s", async (key) => {
    const register = await loadRegister({ ...liveModeEnv(), [key]: undefined });
    await expect(register()).rejects.toThrow(new RegExp(key));
  });

  it("refuses a malformed sign-in setting, and never echoes a secret value", async () => {
    const register = await loadRegister({
      ...liveModeEnv(),
      CARING_CONTACTS_SESSION_ISSUER: "http://sso.example.invalid",
      CARING_CONTACTS_OIDC_ROLE_MAP: JSON.stringify({ admins: "superuser" }),
    });
    const error = await register().then(
      () => null,
      (caught: unknown) => caught as Error,
    );
    expect(error?.message).toMatch(/CARING_CONTACTS_SESSION_ISSUER must be an https URL/);
    expect(error?.message).toMatch(/CARING_CONTACTS_OIDC_ROLE_MAP has an entry/);
    expect(error?.message).not.toContain("oidc-client-secret-value");
  });

  it.each([
    ["attestation", "CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON"],
    ["MAC", "CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC"],
    ["signing secret", "CARING_CONTACTS_GOVERNANCE_HMAC_SECRET"],
  ] as const)("refuses live mode with no governance %s", async (_label, key) => {
    const register = await loadRegister({ ...liveModeEnv(), [key]: undefined });
    await expect(register()).rejects.toThrow(/CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON/);
  });

  it("refuses an attestation whose MAC does not authenticate it", async () => {
    // The whole point of the MAC: an attestation that says every hazard is mitigated is worthless
    // if anyone who can set an environment variable can write one.
    const forged = validAttestation();
    const register = await loadRegister({
      ...liveModeEnv(forged),
      CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC: macFor(forged).replace(/.$/, (c) => (c === "0" ? "1" : "0")),
    });
    await expect(register()).rejects.toThrow(/MAC failed authentication/);
  });

  it("refuses a MAC of a different length instead of throwing out of timingSafeEqual", async () => {
    const register = await loadRegister({ ...liveModeEnv(), CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC: "short" });
    await expect(register()).rejects.toThrow(/MAC failed authentication/);
  });

  it("refuses an authenticated attestation that is not parseable JSON", async () => {
    const register = await loadRegister(liveModeEnv("{ not json"));
    await expect(register()).rejects.toThrow(/not parseable/);
  });

  it("refuses an authenticated attestation with an unmitigated hazard flag", async () => {
    // Authenticated but not approved: the MAC proves who wrote it, the validator decides whether
    // what it says is enough. H-05 is the Aboriginal cultural safety review.
    const payload = JSON.parse(validAttestation());
    payload.hazardMitigations.h05AboriginalCulturalSafetyApproved = false;
    const register = await loadRegister(liveModeEnv(JSON.stringify(payload)));
    await expect(register()).rejects.toThrow(/Unmitigated clinical hazard flags/);
  });

  it("refuses an authenticated attestation that has expired", async () => {
    const payload = JSON.parse(validAttestation());
    payload.pilotScope.validUntilIso = new Date(Date.now() - 1_000).toISOString();
    const register = await loadRegister(liveModeEnv(JSON.stringify(payload)));
    await expect(register()).rejects.toThrow(/expired or has an invalid date/);
  });
});

describe("real text-message sending boot check", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("refuses an unknown transport name", async () => {
    const { register } = await loadInstrumentation({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      CARING_CONTACTS_SMS_TRANSPORT: "carrier-pigeon",
    });
    await expect(register()).rejects.toThrow(/Refusing to start: CARING_CONTACTS_SMS_TRANSPORT must be/);
  });

  it("refuses real sending outside live mode", async () => {
    const { register } = await loadInstrumentation({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      CARING_CONTACTS_SMS_TRANSPORT: "telstra",
    });
    await expect(register()).rejects.toThrow(/requires live mode/);
  });

  it("names the missing carrier settings, never their values", async () => {
    const { register } = await loadInstrumentation({
      NEXT_RUNTIME: "nodejs",
      NODE_ENV: "production",
      CARING_CONTACTS_DEMO_ENABLED: "false",
      CARING_CONTACTS_SMS_TRANSPORT: "telstra",
      CARING_CONTACTS_TELSTRA_CLIENT_ID: "client-id-value-xyz",
    });
    const failure = register();
    await expect(failure).rejects.toThrow(/Missing: .*CARING_CONTACTS_TELSTRA_CLIENT_SECRET/);
    await expect(failure).rejects.not.toThrow(/client-id-value-xyz/);
  });

  it("starts with the default simulated transport", async () => {
    const { register } = await loadInstrumentation({ NEXT_RUNTIME: "nodejs", NODE_ENV: "production" });
    await expect(register()).resolves.toBeUndefined();
  });
});
