// src/instrumentation-node.ts
//
// The Node.js-only half of src/instrumentation.ts, loaded from there with a dynamic import inside
// the `NEXT_RUNTIME === "nodejs"` branch (Next.js's documented pattern). Kept in its own module so
// the Edge build of instrumentation never sees `node:crypto` and stops warning about it.
export async function registerNode() {
  if (process.env.NODE_ENV !== "production") return;

  // Kept from PsychSift's guard (src/lib/caring-contacts-server/session.ts relies on it): the only
  // production process allowed to carry NEXT_PUBLIC_DEMO_MODE is the isolated Playwright build,
  // whose output lives under .next-playwright/<run-id>/dist. Anything else carrying the demo flag
  // in production refuses to start, so two environment variables cannot silently open the
  // workspace on a real deployment.
  if (process.env.PLAYWRIGHT_OFFLINE_MODE === "true") {
    const isolatedOutput = /^\.next-playwright\/[a-z0-9-]+\/dist$/i.test(process.env.NEXT_DIST_DIR ?? "");
    if (isolatedOutput && process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;
    throw new Error("Refusing to start: invalid isolated Playwright offline environment.");
  }
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") {
    throw new Error("Refusing to start: NEXT_PUBLIC_DEMO_MODE is set in a production build.");
  }

  // Real text-message sending (CARING_CONTACTS_SMS_TRANSPORT other than "simulated") is checked
  // at boot, so a half-configured carrier is one refusal naming the missing settings rather than a
  // failure on the sender's first run. It is also refused outside live mode: demo data must never
  // reach a real phone.
  {
    const { configuredTransportKind, resolveMessageTransport } = await import("@/lib/caring-contacts/transport/config");
    let kind: string;
    try {
      kind = configuredTransportKind(process.env);
    } catch (error) {
      throw new Error(`Refusing to start: ${(error as Error).message}`);
    }
    if (kind !== "simulated") {
      if (process.env.CARING_CONTACTS_DEMO_ENABLED !== "false") {
        throw new Error(
          "Refusing to start: real text-message sending (CARING_CONTACTS_SMS_TRANSPORT) requires live mode (CARING_CONTACTS_DEMO_ENABLED=false).",
        );
      }
      try {
        resolveMessageTransport(process.env);
      } catch (error) {
        throw new Error(`Refusing to start: ${(error as Error).message}`);
      }
    }
  }

  // Caring Contacts live (non-demo) sovereign mode: fail closed unless a MAC-authenticated
  // CSO attestation is present and valid (H-00 / H-04 / H-05). Demo/staging mode skips this.
  if (process.env.CARING_CONTACTS_DEMO_ENABLED === "false") {
    if (!process.env.CARING_CONTACTS_DATABASE_URL?.trim()) {
      throw new Error(
        "Refusing to start: Caring Contacts live mode requires CARING_CONTACTS_DATABASE_URL (no in-memory fallback for real-patient writes).",
      );
    }
    // Live mode resolves its actor from the signed production session cookie, never from the
    // forgeable demo role cookie -- so it needs BOTH halves of that arrangement, and neither is
    // checked anywhere else at boot.
    //
    // The secret is what `isCaringContactsLiveEnabled` tests. Without it the workspace is simply
    // shut: every page calls `notFound()` and every API route answers 404. A deployment that has
    // gone to the trouble of configuring a dedicated patient database plainly did not intend
    // that, so it is a misconfiguration to refuse rather than a state to serve.
    if (!process.env.CARING_CONTACTS_SESSION_HMAC_SECRET?.trim()) {
      throw new Error(
        "Refusing to start: Caring Contacts live mode requires CARING_CONTACTS_SESSION_HMAC_SECRET. " +
          "Without it the workspace stays closed and every route answers 404, which a live deployment did not intend.",
      );
    }
    // The other half is the issuer of that cookie: staff sign-in through the organisation's
    // identity provider (OpenID Connect; src/lib/caring-contacts-server/oidc.ts). Without every
    // sign-in setting, nobody could ever obtain a session and every request would be refused, so
    // an incomplete sign-in configuration is one refusal at boot naming what is missing. Only
    // variable names are reported, never values (the client secret is one of them).
    // CARING_CONTACTS_SESSION_ISSUER is the identity provider's issuer URL.
    const { readOidcConfig } = await import("@/lib/caring-contacts-server/oidc-config");
    const signIn = readOidcConfig(process.env);
    if (!signIn.ok) {
      throw new Error(
        "Refusing to start: Caring Contacts live mode has no working session issuer (staff sign-in). " +
          signIn.problems.join(" "),
      );
    }
    const { createHmac, timingSafeEqual } = await import("node:crypto");
    const { assertPilotGovernanceReady } = await import("@/lib/caring-contacts/pilot-governance");
    const raw = process.env.CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON?.trim();
    const mac = process.env.CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC?.trim();
    const secret = process.env.CARING_CONTACTS_GOVERNANCE_HMAC_SECRET?.trim();
    if (!raw || !mac || !secret) {
      throw new Error(
        "Refusing to start: Caring Contacts live mode requires CARING_CONTACTS_GOVERNANCE_ATTESTATION_JSON, " +
          "CARING_CONTACTS_GOVERNANCE_ATTESTATION_MAC, and CARING_CONTACTS_GOVERNANCE_HMAC_SECRET.",
      );
    }
    const expectedMac = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
    const expectedBuf = Buffer.from(expectedMac, "utf8");
    const providedBuf = Buffer.from(mac, "utf8");
    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      throw new Error("Refusing to start: Caring Contacts governance attestation MAC failed authentication.");
    }
    let attestation: unknown;
    try {
      attestation = JSON.parse(raw);
    } catch {
      throw new Error("Refusing to start: Caring Contacts governance attestation JSON is not parseable.");
    }
    assertPilotGovernanceReady(false, attestation);
  }
}
