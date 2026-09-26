// src/lib/caring-contacts-server/workspace-gate.ts
//
// Whether the Caring Contacts workspace is open in this process, read from the environment alone.
// Split out of ./session so the request proxy (src/proxy.ts) can ask the same question the pages
// ask before they call `notFound()`, without importing cookies, crypto or "server-only". It has no
// imports on purpose; ./session re-exports everything here, so existing callers are unchanged.

export const CARING_CONTACTS_SESSION_HMAC_SECRET_VAR = "CARING_CONTACTS_SESSION_HMAC_SECRET";
export const CARING_CONTACTS_DEMO_ENABLED_VAR = "CARING_CONTACTS_DEMO_ENABLED";
export const CARING_CONTACTS_DATABASE_URL_VAR = "CARING_CONTACTS_DATABASE_URL";

/**
 * The role switcher is a development/test demonstration aid, not authentication.
 *
 * A caller can forge a role-only cookie outside a browser, so `httpOnly` is not
 * an authorization boundary. Until enterprise authentication supplies a real
 * actor, Caring Contacts routes must fail closed in production — with:
 *   1. the isolated Playwright exception (unchanged), and
 *   2. the sovereign demo path: `CARING_CONTACTS_DEMO_ENABLED=true` PLUS a
 *      configured session HMAC secret, with role cookies signed by that secret.
 *      Signing is integrity for the role cookie only — not proof of identity. Missing/invalid
 *      cookies still default to coordinator; POST /session issues signed roles without client proof.
 */
export function isCaringContactsDemoEnabled(
  environment = process.env.NODE_ENV,
  // Same shape `shouldBlockProductionMockups` uses for the same reason: `process.env`
  // is an index signature, so a named-optional type is rejected as a weak type.
  runtime: Record<string, string | undefined> = process.env,
): boolean {
  if (environment !== "production") return true;

  // The single Playwright exception, and it is the same one `shouldBlockProductionMockups`
  // (src/proxy.ts) already makes for /mockups: the repository-owned isolated
  // Playwright server builds a real production app so the browser gate tests what
  // ships. Both flags are required; instrumentation refuses any other production
  // process carrying NEXT_PUBLIC_DEMO_MODE.
  if (runtime.PLAYWRIGHT_OFFLINE_MODE === "true" && runtime.NEXT_PUBLIC_DEMO_MODE === "true") {
    return true;
  }

  // Sovereign staging / clinical-simulation path. The HMAC secret is required before the
  // demo flag can open the workspace, but it is not human authentication: demo actors remain
  // forgeable/defaulted. Without the secret the flag is ignored.
  return runtime[CARING_CONTACTS_DEMO_ENABLED_VAR] === "true" && hasProductionSessionSecret(runtime);
}

/**
 * Live (non-demo) sovereign mode: demo explicitly disabled, a session HMAC
 * secret configured, AND the dedicated Caring Contacts database URL present.
 * Without `CARING_CONTACTS_DATABASE_URL` the store factory would fall back to
 * an in-memory repository, so real-patient writes could appear to succeed and
 * then vanish on restart — live mode therefore fails closed without it.
 * Actor resolution uses the signed production session cookie, not the
 * forgeable demo role cookie. Pilot governance attestation is enforced at boot
 * by instrumentation.register when this mode is active.
 */
export function isCaringContactsLiveEnabled(
  environment = process.env.NODE_ENV,
  runtime: Record<string, string | undefined> = process.env,
): boolean {
  if (environment !== "production") return false;
  return (
    runtime[CARING_CONTACTS_DEMO_ENABLED_VAR] === "false" &&
    hasProductionSessionSecret(runtime) &&
    Boolean(runtime[CARING_CONTACTS_DATABASE_URL_VAR]?.trim())
  );
}

/** True when any Caring Contacts page or API may serve (demo, live, or non-production). */
export function isCaringContactsWorkspaceEnabled(
  environment = process.env.NODE_ENV,
  runtime: Record<string, string | undefined> = process.env,
): boolean {
  return isCaringContactsDemoEnabled(environment, runtime) || isCaringContactsLiveEnabled(environment, runtime);
}

export function hasProductionSessionSecret(runtime: Record<string, string | undefined> = process.env): boolean {
  return Boolean(runtime[CARING_CONTACTS_SESSION_HMAC_SECRET_VAR]?.trim());
}
