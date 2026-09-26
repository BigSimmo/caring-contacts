// tests/caring-contacts-inbound-routes.test.ts
//
// Incoming text messages (2026-09-26): the carrier's inbound webhook and the staff "mark followed
// up" route. The store is a fresh demo store per test (Rowan's active plan and Ari's withdrawn one
// share the fictional number +61 491 570 156) and the transport is always simulated -- nothing
// here can reach a phone or a carrier.
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  cookies: { current: {} as Record<string, { value: string } | undefined> },
}));

vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mocks.cookies.current[name] })),
}));

import { POST as followUpPost } from "@/app/api/caring-contacts/inbound-replies/[replyId]/route";
import { POST as inboundPost } from "@/app/api/caring-contacts/inbound/webhook/route";
import { resetSenderTransportForTests } from "@/lib/caring-contacts-server/contact-sender";
import { createDemoWorkspaceStore } from "@/lib/caring-contacts-server/demo-seed";
import { INBOUND_WEBHOOK_SECRET_HEADER } from "@/lib/caring-contacts-server/inbound-webhook";
import { CARING_CONTACTS_ROLE_COOKIE, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { systemClock } from "@/lib/caring-contacts/clock";
import { planId } from "@/lib/caring-contacts/ids";
import type { CaringContactRole } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { logger } from "@/lib/logger";

const SECRET = "i".repeat(48);
const ROWAN_PLAN = "demo-seed-plan-rowan";
const ARI_PLAN = "demo-seed-plan-ari";
const coordinator = demoActorForRole("coordinator");

let store: CaringContactRepository;
let logged: string[];

beforeEach(async () => {
  store = await createDemoWorkspaceStore(systemClock());
  mocks.store.current = store;
  mocks.cookies.current = {};
  resetSenderTransportForTests();
  logged = [];
  for (const level of ["debug", "info", "warn", "error"] as const) {
    vi.spyOn(logger, level).mockImplementation((message: string, context?: Record<string, unknown>) => {
      logged.push(`${level} ${message} ${JSON.stringify(context ?? {})}`);
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetSenderTransportForTests();
});

function inbound(
  body: unknown,
  options: { secret?: string | null; via?: "header" | "bearer" | "query"; raw?: string } = {},
): Request {
  const secret = options.secret === undefined ? SECRET : options.secret;
  const via = options.via ?? "header";
  const headers: Record<string, string> = { "content-type": "application/json" };
  let url = "http://127.0.0.1/api/caring-contacts/inbound/webhook";
  if (secret !== null) {
    if (via === "header") headers[INBOUND_WEBHOOK_SECRET_HEADER] = secret;
    if (via === "bearer") headers.authorization = `Bearer ${secret}`;
    if (via === "query") url += `?token=${encodeURIComponent(secret)}`;
  }
  return new Request(url, { method: "POST", headers, body: options.raw ?? JSON.stringify(body) });
}

const STOP_FROM_ROWAN = { from: "0491 570 156", messageContent: "Stop, I can't do this anymore", messageId: "m-1" };

describe("POST /api/caring-contacts/inbound/webhook", () => {
  it("does not exist until a strong secret is configured", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", "");
    expect((await inboundPost(inbound(STOP_FROM_ROWAN))).status).toBe(404);
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", "too-short");
    expect((await inboundPost(inbound(STOP_FROM_ROWAN, { secret: "too-short" }))).status).toBe(404);
    expect(await store.listOpenInboundReplies({ actor: coordinator })).toEqual([]);
  });

  it("does not exist while the workspace is switched off", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    // Production with no live mode and no demo exception: the workspace gate is shut.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PLAYWRIGHT_OFFLINE_MODE", "false");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
    vi.stubEnv("CARING_CONTACTS_DEMO_ENABLED", "false");
    expect((await inboundPost(inbound(STOP_FROM_ROWAN))).status).toBe(404);
  });

  it("refuses a missing or wrong secret, recording and sending nothing", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    expect((await inboundPost(inbound(STOP_FROM_ROWAN, { secret: null }))).status).toBe(401);
    expect((await inboundPost(inbound(STOP_FROM_ROWAN, { secret: "x".repeat(48) }))).status).toBe(401);
    expect((await inboundPost(inbound(STOP_FROM_ROWAN, { secret: `${SECRET}x` }))).status).toBe(401);
    expect(await store.listOpenInboundReplies({ actor: coordinator })).toEqual([]);
    expect((await store.getPlan(planId(ROWAN_PLAN), { actor: coordinator }))?.plan.state).toBe("active");
  });

  it.each(["header", "bearer", "query"] as const)("accepts the secret as a %s", async (via) => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    const response = await inboundPost(inbound({ from: "+61491570156", body: "thanks" }, { via }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "received" });
  });

  it("refuses an oversized body with 413 and an unreadable one with 400", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    const huge = { from: "0491570156", body: "a".repeat(20_000) };
    expect((await inboundPost(inbound(huge))).status).toBe(413);
    expect((await inboundPost(inbound(null, { raw: "{not json" }))).status).toBe(400);
    expect((await inboundPost(inbound({ from: "0491570156" }))).status).toBe(400);
    expect((await inboundPost(inbound({ from: "0491570156", body: "STOP", text: "hi" }))).status).toBe(400);
  });

  it("pauses the active plan on STOP, files every plan on the number, and never withdraws", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    const response = await inboundPost(inbound(STOP_FROM_ROWAN));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "received" });

    expect((await store.getPlan(planId(ROWAN_PLAN), { actor: coordinator }))?.plan.state).toBe("paused");
    expect((await store.getPlan(planId(ARI_PLAN), { actor: coordinator }))?.plan.state).toBe("withdrawn");
    const open = await store.listOpenInboundReplies({ actor: coordinator });
    expect(open.map((reply) => [reply.planId, reply.kind, reply.planPaused]).sort()).toEqual([
      [ARI_PLAN, "optOutRequest", false],
      [ROWAN_PLAN, "optOutRequest", true],
    ]);
    const words = await store.listInboundReplies(planId(ROWAN_PLAN), { actor: coordinator });
    expect(words.map((reply) => reply.text)).toEqual(["Stop, I can't do this anymore"]);
  });

  it("logs no number and no words, only kinds, counts and reason codes", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    await inboundPost(inbound(STOP_FROM_ROWAN));
    await inboundPost(inbound({ from: "+14155550100", body: "hello from abroad" }));
    await inboundPost(inbound({ from: "0412 345 678", body: "wrong number, who is this" }));
    expect(logged.length).toBeGreaterThan(0);
    const all = logged.join("\n");
    for (const forbidden of ["491", "570", "156", "4155550100", "412", "345", "678", "can't", "abroad", "who is"]) {
      expect(all).not.toContain(forbidden);
    }
    expect(all).not.toContain(SECRET);
    expect(all).toContain('"kind":"optOutRequest"');
    expect(all).toContain('"plansPaused":1');
  });

  it("answers a number once a day: the second text is filed but not answered again", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    await inboundPost(inbound({ from: "0491570156", body: "first", messageId: "a-1" }));
    await inboundPost(inbound({ from: "0491570156", body: "second", messageId: "a-2" }));
    const autoReplies = logged
      .filter((line) => line.includes("Caring Contacts inbound text"))
      .map((line) => {
        const match = /"autoReply":"(\w+)"/.exec(line);
        return match?.[1];
      });
    expect(autoReplies).toEqual(["sent", "rateLimited"]);
    expect(await store.listOpenInboundReplies({ actor: coordinator })).toHaveLength(4);
  });

  it("answers an unknown number and stores nothing about it", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    const response = await inboundPost(inbound({ from: "0412 345 678", body: "STOP" }));
    expect(response.status).toBe(200);
    expect(await store.listOpenInboundReplies({ actor: coordinator })).toEqual([]);
    expect(logged.join("\n")).toContain('"autoReply":"sent"');
  });

  it("ignores a number that is not an Australian mobile without asking the carrier to retry", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    const response = await inboundPost(inbound({ from: "+14155550100", body: "STOP" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ result: "ignored" });
  });

  it("asks the carrier to retry when filing the reply failed", async () => {
    vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
    mocks.store.current = Object.create(store, {
      recordInboundReply: {
        value: async () => {
          throw new Error("database unavailable");
        },
      },
    });
    const response = await inboundPost(inbound(STOP_FROM_ROWAN));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ result: "retry" });
  });
});

// ---------------------------------------------------------------------------
// Marking a reply followed up
// ---------------------------------------------------------------------------

async function aFiledReply(): Promise<{ replyId: string; version: number }> {
  vi.stubEnv("CARING_CONTACTS_INBOUND_WEBHOOK_SECRET", SECRET);
  const response = await inboundPost(inbound({ from: "0491570156", body: "thanks", messageId: "f-1" }));
  expect(response.status).toBe(200);
  const open = await store.listOpenInboundReplies({ actor: coordinator });
  const reply = open.find((entry) => entry.planId === ROWAN_PLAN);
  if (!reply) throw new Error("expected a reply on Rowan's plan");
  return { replyId: reply.id, version: reply.version };
}

function followUp(replyId: string, body: unknown, role: CaringContactRole = "coordinator") {
  mocks.cookies.current = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  const request = new NextRequest(`http://localhost/api/caring-contacts/inbound-replies/${replyId}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return followUpPost(request, { params: Promise.resolve({ replyId }) });
}

describe("POST /api/caring-contacts/inbound-replies/[replyId]", () => {
  it("marks a reply followed up once, and takes it off the open list", async () => {
    const { replyId, version } = await aFiledReply();
    const done = await followUp(replyId, { planId: ROWAN_PLAN, expectedVersion: version, idempotencyKey: "FU-1" });
    expect(done.status).toBe(200);
    const body = (await done.json()) as { value: { followedUpBy: string; version: number } };
    expect(body.value).toMatchObject({ followedUpBy: coordinator.id, version: version + 1 });
    expect(JSON.stringify(body)).not.toContain("thanks");

    const open = await store.listOpenInboundReplies({ actor: coordinator });
    expect(open.map((reply) => reply.id)).not.toContain(replyId);

    const again = await followUp(replyId, {
      planId: ROWAN_PLAN,
      expectedVersion: version + 1,
      idempotencyKey: "FU-2",
    });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ refusal: "inbound-reply-already-followed-up" });
  });

  it("refuses a role without the capability, and records the refusal", async () => {
    const { replyId, version } = await aFiledReply();
    const refused = await followUp(
      replyId,
      { planId: ROWAN_PLAN, expectedVersion: version, idempotencyKey: "FU-AUD" },
      "auditor",
    );
    expect(refused.status).toBe(403);
    const trail = await store.listAccessTrail({ limit: 50, offset: 0 }, { actor: demoActorForRole("auditor") });
    expect(trail).toContainEqual(expect.objectContaining({ objectType: "inboundReply", outcome: "denied" }));
  });

  it("refuses a malformed reply id or body before reaching the store", async () => {
    expect(
      (await followUp("not-a-reply", { planId: ROWAN_PLAN, expectedVersion: 1, idempotencyKey: "K" })).status,
    ).toBe(400);
    const { replyId } = await aFiledReply();
    expect((await followUp(replyId, { planId: ROWAN_PLAN, expectedVersion: 1 })).status).toBe(400);
    expect((await followUp(replyId, { planId: "Rowan Example", expectedVersion: 1, idempotencyKey: "K" })).status).toBe(
      400,
    );
    expect(
      (await followUp(replyId, { planId: ROWAN_PLAN, expectedVersion: 1, idempotencyKey: "K", note: "x" })).status,
    ).toBe(400);
  });

  it("answers a reply on another plan as not found", async () => {
    const { replyId, version } = await aFiledReply();
    const response = await followUp(replyId, { planId: ARI_PLAN, expectedVersion: version, idempotencyKey: "FU-X" });
    expect(response.status).toBe(404);
  });
});
