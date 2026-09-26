// tests/helpers/mock-oidc-provider.ts
//
// A tiny OpenID Connect provider for the offline tests ONLY. It is never shipped or routed: it
// listens on 127.0.0.1 on a random port for the length of a test file and serves the three things
// a relying party needs -- the discovery document, the signing keys (JWKS) and the token endpoint.
//
// The "browser" step is `authorize(url, options)`: the test hands it the authorization URL the
// app redirected to, and it returns the callback URL a real provider would send the browser back
// to, having remembered the nonce and PKCE challenge against a one-time code. The token endpoint
// then insists on the right client credentials, redirect URI and PKCE verifier, as a real one would.
// `options` lets a test make the provider misbehave: wrong nonce, a forged signature, an expired
// token, different groups.
import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK } from "jose";

export type AuthorizeOptions = {
  /** Extra or replacement ID token claims (e.g. `{ groups: [...] }`). */
  claims?: Record<string, unknown>;
  /** Put this nonce in the ID token instead of the one the app sent. */
  nonce?: string;
  /** Sign with a key the provider never published (same key id), so the signature cannot verify. */
  forgeSignature?: boolean;
  /** Issue a token that expired an hour ago. */
  expired?: boolean;
  /** Use this `aud` instead of the client id. */
  audience?: string | string[];
};

type PendingCode = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  nonce: string;
  options: AuthorizeOptions;
};

export type MockOidcProvider = {
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** Default ID token claims for a mapped staff member. */
  subject: string;
  /** Simulates the browser visiting the provider and being sent back. Returns the callback URL. */
  authorize(authorizationUrl: string, options?: AuthorizeOptions): URL;
  /** Number of successful token exchanges, so a test can prove the code is single-use. */
  tokenRequests(): number;
  close(): Promise<void>;
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export async function startMockOidcProvider(
  clientId = "caring-contacts-test-client",
  clientSecret = "test-client-secret",
): Promise<MockOidcProvider> {
  const signing = await generateKeyPair("RS256", { extractable: true });
  const forger = await generateKeyPair("RS256", { extractable: true });
  const kid = "mock-key-1";
  const publicJwk: JWK = { ...(await exportJWK(signing.publicKey)), kid, alg: "RS256", use: "sig" };
  const codes = new Map<string, PendingCode>();
  let exchanges = 0;
  const subject = "staff-subject-0001";

  let issuer = "";

  async function idTokenFor(pending: PendingCode): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const iat = pending.options.expired ? now - 7200 : now;
    const exp = pending.options.expired ? now - 3600 : now + 3600;
    const key: CryptoKey = pending.options.forgeSignature ? forger.privateKey : signing.privateKey;
    return new SignJWT({
      nonce: pending.options.nonce ?? pending.nonce,
      groups: ["cc-coordinators", "cc-team-north"],
      ...pending.options.claims,
    })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(issuer)
      .setSubject(subject)
      .setAudience(pending.options.audience ?? pending.clientId)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(key);
  }

  const server: Server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", issuer);
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    };
    if (request.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
        code_challenge_methods_supported: ["S256"],
      });
    }
    if (request.method === "GET" && url.pathname === "/jwks") return json(200, { keys: [publicJwk] });
    if (request.method === "POST" && url.pathname === "/token") {
      const form = new URLSearchParams(await readBody(request));
      const expectedAuth = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
      if (request.headers.authorization !== expectedAuth) return json(401, { error: "invalid_client" });
      const code = form.get("code") ?? "";
      const pending = codes.get(code);
      codes.delete(code);
      if (!pending || form.get("grant_type") !== "authorization_code") return json(400, { error: "invalid_grant" });
      if (form.get("redirect_uri") !== pending.redirectUri) return json(400, { error: "invalid_grant" });
      const verifier = form.get("code_verifier") ?? "";
      const challenge = createHash("sha256").update(verifier).digest("base64url");
      if (challenge !== pending.codeChallenge) return json(400, { error: "invalid_grant" });
      exchanges += 1;
      return json(200, {
        access_token: "mock-access-token",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: await idTokenFor(pending),
      });
    }
    return json(404, { error: "not_found" });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  issuer = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    issuer,
    clientId,
    clientSecret,
    subject,
    authorize(authorizationUrl, options = {}) {
      const url = new URL(authorizationUrl);
      if (`${url.origin}${url.pathname}` !== `${issuer}/authorize`) throw new Error("not this provider's URL");
      const params = url.searchParams;
      if (params.get("response_type") !== "code") throw new Error("expected response_type=code");
      if (params.get("code_challenge_method") !== "S256") throw new Error("expected PKCE S256");
      if (!params.get("scope")?.split(" ").includes("openid")) throw new Error("expected the openid scope");
      const redirectUri = params.get("redirect_uri") ?? "";
      const code = randomBytes(16).toString("hex");
      codes.set(code, {
        clientId: params.get("client_id") ?? "",
        redirectUri,
        codeChallenge: params.get("code_challenge") ?? "",
        nonce: params.get("nonce") ?? "",
        options,
      });
      const callback = new URL(redirectUri);
      callback.searchParams.set("code", code);
      callback.searchParams.set("state", params.get("state") ?? "");
      return callback;
    },
    tokenRequests: () => exchanges,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}
