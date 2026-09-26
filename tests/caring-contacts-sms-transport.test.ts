// The Telstra adapter, its configuration and the delivery-receipt address, proved against a FAKE
// HTTP server on 127.0.0.1. Nothing here ever contacts Telstra.
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveMessageTransport, SmsTransportConfigError } from "@/lib/caring-contacts/transport/config";
import {
  buildDeliveryReceiptUrl,
  DELIVERY_WEBHOOK_PATH,
  verifyDeliveryReceiptParams,
} from "@/lib/caring-contacts/transport/delivery-link";
import { providerStatusFromCarrier } from "@/lib/caring-contacts/transport/delivery-receipts";
import { isDesignatedFictionalMobile, toAustralianMobileE164 } from "@/lib/caring-contacts/transport/phone";
import {
  assertAustralianSmsEndpoint,
  createTelstraTransport,
  NonAustralianSmsEndpointError,
} from "@/lib/caring-contacts/transport/telstra";

type Seen = { method?: string; url?: string; headers: IncomingMessage["headers"]; body: string };

let server: Server;
let base: string;
let seen: Seen[];
let respond: (request: Seen) => { status: number; body?: unknown; delayMs?: number };

beforeEach(async () => {
  seen = [];
  respond = (request) =>
    request.url === "/v2/oauth/token"
      ? { status: 200, body: { access_token: "fake-token", expires_in: 3600 } }
      : { status: 201, body: { messageId: "fake-message-1", status: "queued" } };
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request: Seen = { method: req.method, url: req.url, headers: req.headers, body };
      seen.push(request);
      const answer = respond(request);
      setTimeout(() => {
        res.writeHead(answer.status, { "content-type": "application/json" });
        res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
      }, answer.delayMs ?? 0);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const PHONE = "+61412345678";
const TEXT = "Hi Kai, a governed test message body.";

function transport(options: { timeoutMs?: number } = {}) {
  return createTelstraTransport(
    { clientId: "client-id", clientSecret: "client-secret", from: "+61400000000", apiBaseUrl: base },
    { allowLoopbackForTests: true, ...options },
  );
}

const message = {
  to: PHONE,
  body: TEXT,
  reference: "plan-1--contact-2",
  deliveryReceiptUrl: "https://example.test/dlr",
};

describe("Telstra transport against a fake server", () => {
  it("gets a token once, then sends the documented request shape", async () => {
    const sms = transport();
    const first = await sms.send(message);
    const second = await sms.send(message);

    expect(first).toEqual({ outcome: "accepted", providerMessageId: "fake-message-1" });
    expect(second.outcome).toBe("accepted");
    expect(seen.map((request) => request.url)).toEqual([
      "/v2/oauth/token",
      "/messaging/v3/messages",
      "/messaging/v3/messages",
    ]);

    const token = new URLSearchParams(seen[0].body);
    expect(token.get("grant_type")).toBe("client_credentials");
    expect(token.get("client_id")).toBe("client-id");

    const send = seen[1];
    expect(send.headers.authorization).toBe("Bearer fake-token");
    expect(token.get("scope")).toBe("messages:read messages:write");
    expect(send.method).toBe("POST");
    expect(send.headers["telstra-api-version"]).toBe("3.x");
    expect(send.headers["content-language"]).toBe("en-au");
    expect(send.headers["accept-charset"]).toBe("utf-8");
    expect(send.headers["content-type"]).toBe("application/json");
    expect(JSON.parse(send.body)).toEqual({
      to: PHONE,
      from: "+61400000000",
      messageContent: TEXT,
      deliveryNotification: true,
      statusCallbackUrl: "https://example.test/dlr",
    });
  });

  it("asks for no delivery notification when there is no receipt address", async () => {
    await transport().send({ ...message, deliveryReceiptUrl: null });
    expect(JSON.parse(seen[1].body)).toEqual({ to: PHONE, from: "+61400000000", messageContent: TEXT });
  });

  it("reads Telstra's message id whether it comes as a string or a one-item list", async () => {
    respond = (request) =>
      request.url === "/v2/oauth/token"
        ? { status: 200, body: { access_token: "t", expires_in: "3599" } }
        : { status: 201, body: { messageId: ["fake-message-9"], status: "queued" } };
    expect(await transport().send(message)).toEqual({ outcome: "accepted", providerMessageId: "fake-message-9" });

    respond = (request) =>
      request.url === "/v2/oauth/token"
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 201, body: { messageId: ["a", "b"], status: "queued" } };
    expect(await transport().send(message)).toEqual({ outcome: "accepted", providerMessageId: null });
  });

  it("reports a carrier refusal as not sent, without echoing the number, text or reply", async () => {
    respond = (request) =>
      request.url === "/v2/oauth/token"
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 400, body: { error: `bad number ${PHONE} for ${TEXT}` } };
    const result = await transport().send(message);
    expect(result).toEqual({ outcome: "rejected", reason: "carrier-refused-400" });
    expect(JSON.stringify(result)).not.toContain("412345678");
  });

  it("reports a failed sign-in as not sent and never attempts the message", async () => {
    respond = () => ({ status: 401, body: { error: "invalid_client" } });
    expect(await transport().send(message)).toEqual({ outcome: "rejected", reason: "carrier-authentication-failed" });
    expect(seen.map((request) => request.url)).toEqual(["/v2/oauth/token"]);
  });

  it("reports a carrier server error or a timeout as unknown, never as not sent", async () => {
    respond = (request) =>
      request.url === "/v2/oauth/token"
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 503 };
    expect(await transport().send(message)).toEqual({ outcome: "unknown", reason: "carrier-error-503" });

    respond = (request) =>
      request.url === "/v2/oauth/token"
        ? { status: 200, body: { access_token: "t", expires_in: 3600 } }
        : { status: 201, body: {}, delayMs: 500 };
    expect(await transport({ timeoutMs: 100 }).send(message)).toEqual({
      outcome: "unknown",
      reason: "carrier-timeout",
    });
  });

  it("reports an unreachable carrier as not sent", async () => {
    const closed = createTelstraTransport(
      { clientId: "a", clientSecret: "b", from: "c", apiBaseUrl: "http://127.0.0.1:1" },
      { allowLoopbackForTests: true },
    );
    expect(await closed.send(message)).toEqual({ outcome: "rejected", reason: "carrier-authentication-failed" });
  });
});

describe("the Australian-endpoint rule", () => {
  it("accepts only Telstra's Australian API hosts over https", () => {
    expect(assertAustralianSmsEndpoint("https://products.api.telstra.com").hostname).toBe("products.api.telstra.com");
    for (const bad of [
      "https://tapi.telstra.com",
      "http://products.api.telstra.com",
      "https://api.twilio.com",
      "https://products.api.telstra.com.evil.example",
      "https://user:pass@products.api.telstra.com",
      "http://127.0.0.1:9999",
      "not a url",
    ]) {
      expect(() => assertAustralianSmsEndpoint(bad), bad).toThrow(NonAustralianSmsEndpointError);
    }
  });

  it("refuses to build the transport for a non-Australian endpoint", () => {
    expect(() =>
      createTelstraTransport({ clientId: "a", clientSecret: "b", from: "c", apiBaseUrl: "https://api.example.com" }),
    ).toThrow(NonAustralianSmsEndpointError);
  });
});

describe("transport configuration", () => {
  const complete = {
    CARING_CONTACTS_SMS_TRANSPORT: "telstra",
    CARING_CONTACTS_TELSTRA_CLIENT_ID: "id",
    CARING_CONTACTS_TELSTRA_CLIENT_SECRET: "secret",
    CARING_CONTACTS_TELSTRA_FROM: "+61400000000",
    CARING_CONTACTS_PUBLIC_BASE_URL: "https://caring.example.gov.au",
    CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET: "x".repeat(40),
  };

  it("is simulated unless real sending is switched on", () => {
    expect(resolveMessageTransport({}).transport.kind).toBe("simulated");
    expect(resolveMessageTransport({ CARING_CONTACTS_TELSTRA_CLIENT_ID: "id" }).transport.kind).toBe("simulated");
    expect(resolveMessageTransport({}).transport.reachesRealPhones).toBe(false);
  });

  it("builds the Telstra transport only when every setting is present", () => {
    const resolved = resolveMessageTransport(complete);
    expect(resolved.transport.kind).toBe("telstra");
    expect(resolved.deliveryReceipts?.publicBaseUrl).toBe("https://caring.example.gov.au");
  });

  it("refuses a half-configured real setup instead of quietly simulating", () => {
    const partial: Record<string, string> = { ...complete };
    delete partial.CARING_CONTACTS_TELSTRA_CLIENT_SECRET;
    expect(() => resolveMessageTransport(partial)).toThrow(SmsTransportConfigError);
    expect(() => resolveMessageTransport({ ...complete, CARING_CONTACTS_DELIVERY_WEBHOOK_SECRET: "short" })).toThrow(
      SmsTransportConfigError,
    );
    expect(() =>
      resolveMessageTransport({ ...complete, CARING_CONTACTS_PUBLIC_BASE_URL: "http://caring.example" }),
    ).toThrow(SmsTransportConfigError);
    expect(() => resolveMessageTransport({ ...complete, CARING_CONTACTS_SMS_TRANSPORT: "twilio" })).toThrow(
      SmsTransportConfigError,
    );
  });

  it("refuses a non-Australian API address, and a loopback one outside tests", () => {
    expect(() =>
      resolveMessageTransport({ ...complete, CARING_CONTACTS_TELSTRA_API_BASE_URL: "https://sms.example.com" }),
    ).toThrow(NonAustralianSmsEndpointError);
    expect(() =>
      resolveMessageTransport(
        { ...complete, CARING_CONTACTS_TELSTRA_API_BASE_URL: "http://127.0.0.1:1234" },
        { nodeEnv: "production" },
      ),
    ).toThrow(NonAustralianSmsEndpointError);
  });
});

describe("delivery-receipt addresses", () => {
  const secret = "s".repeat(40);
  const reference = { teamId: "team-a", planId: "plan-1", contactId: "plan-1--contact-2" };

  it("verifies its own address and refuses any altered one", () => {
    const url = new URL(buildDeliveryReceiptUrl("https://caring.example.gov.au", reference, secret));
    expect(url.pathname).toBe(DELIVERY_WEBHOOK_PATH);
    expect(url.toString()).not.toContain(secret);
    expect(verifyDeliveryReceiptParams(url.searchParams, secret)).toEqual(reference);

    const altered = new URLSearchParams(url.searchParams);
    altered.set("c", "plan-1--contact-3");
    expect(verifyDeliveryReceiptParams(altered, secret)).toBeNull();
    expect(verifyDeliveryReceiptParams(url.searchParams, "t".repeat(40))).toBeNull();
    const unsigned = new URLSearchParams(url.searchParams);
    unsigned.delete("s");
    expect(verifyDeliveryReceiptParams(unsigned, secret)).toBeNull();
  });

  it("maps only final carrier statuses", () => {
    expect(providerStatusFromCarrier("delivered")).toBe("delivered");
    expect(providerStatusFromCarrier("undeliverable")).toBe("notDelivered");
    expect(providerStatusFromCarrier("expired")).toBe("notDelivered");
    expect(providerStatusFromCarrier("queued")).toBeNull();
    expect(providerStatusFromCarrier("sent")).toBeNull();
    // Not Telstra v3 words: left for a person to check rather than guessed at.
    expect(providerStatusFromCarrier("read")).toBeNull();
    expect(providerStatusFromCarrier("failed")).toBeNull();
    expect(providerStatusFromCarrier(42)).toBeNull();
  });
});

describe("Australian mobile numbers", () => {
  it("normalises the stored forms and refuses anything else", () => {
    expect(toAustralianMobileE164("0412 345 678")).toBe("+61412345678");
    expect(toAustralianMobileE164("+61 412-345-678")).toBe("+61412345678");
    expect(toAustralianMobileE164("(08) 9222 4222")).toBeNull();
    expect(toAustralianMobileE164("+1 415 555 0100")).toBeNull();
    expect(toAustralianMobileE164(null)).toBeNull();
    expect(isDesignatedFictionalMobile("+61491570156")).toBe(true);
  });
});
