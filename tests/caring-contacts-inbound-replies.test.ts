// tests/caring-contacts-inbound-replies.test.ts
//
// Incoming text messages (2026-09-26): the rules in src/lib/caring-contacts/inbound-replies.ts, the
// carrier-body parser, the fixed automatic reply, and the receiver that ties them together. The
// store behaviour is proven in the shared repository contract (both stores); the route in
// tests/caring-contacts-inbound-routes.test.ts.
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { fixedClock } from "@/lib/caring-contacts/clock";
import { patientId, planId, teamId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { receiveInboundTextMessage } from "@/lib/caring-contacts/inbound-receiver";
import {
  admitInboundReplyText,
  admitRecordInboundReplyInput,
  applyInboundReplyFollowUp,
  choosePlansForInboundReply,
  classifyInboundReply,
  inboundReplyActorsForTeam,
  inboundReplyIdFor,
  inboundSenderKey,
  INBOUND_REPLY_REFUSALS,
  INBOUND_REPLY_TEXT_MAX_LENGTH,
  INBOUND_SENDER_KEY_PATTERN,
  isInboundReplyId,
  optOutPausesPlan,
  type InboundReplyPlanMatch,
  type InboundReplyRecord,
} from "@/lib/caring-contacts/inbound-replies";
import { INBOUND_AUTO_REPLY_GSM7, INBOUND_AUTO_REPLY_MESSAGE } from "@/lib/caring-contacts/message-copy";
import { canPerformCaringContactAction } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { parseInboundTextMessage } from "@/lib/caring-contacts/transport/inbound";
import { createSimulatedTransport } from "@/lib/caring-contacts/transport/simulated";
import type { MessageTransport, OutboundTextMessage } from "@/lib/caring-contacts/transport/types";

describe("classifyInboundReply", () => {
  it.each([
    "STOP",
    "stop",
    " Stop. ",
    "STOP ALL",
    "stop   all",
    "Unsubscribe",
    "cancel",
    "END",
    "quit!",
    "opt out",
    "OPT-OUT",
    "optout",
    "stop​",
  ])("reads %j as an opt-out request", (text) => {
    expect(classifyInboundReply(text)).toBe("optOutRequest");
  });

  it.each(["Stop, I can't do this anymore", "STOP texting me", "stop please", "Stop!!! please"])(
    "reads the ambiguous %j as an opt-out request, so a person reviews a paused plan",
    (text) => {
      expect(classifyInboundReply(text)).toBe("optOutRequest");
    },
  );

  it.each([
    "I can't stop crying",
    "Please don't stop the messages",
    "stopped by the shops",
    "unstoppable",
    "The end is near",
    "cancel my appointment tomorrow",
    "Thanks, doing ok",
    "",
  ])("reads %j as an ordinary reply, which still reaches a person", (text) => {
    expect(classifyInboundReply(text)).toBe("reply");
  });
});

describe("admitInboundReplyText", () => {
  it("trims, refuses a blank message, and keeps long words rather than dropping them", () => {
    expect(admitInboundReplyText("  hello  ")).toBe("hello");
    expect(admitInboundReplyText(" \n\t ")).toBeNull();
    const long = "a".repeat(INBOUND_REPLY_TEXT_MAX_LENGTH + 50);
    expect(admitInboundReplyText(long)).toHaveLength(INBOUND_REPLY_TEXT_MAX_LENGTH);
  });

  it("never splits an emoji, and admitting an admitted text changes nothing", () => {
    const emoji = "\u{1F49A}".repeat(INBOUND_REPLY_TEXT_MAX_LENGTH + 1);
    const admitted = admitInboundReplyText(emoji);
    expect(admitted === null ? 0 : [...admitted].length).toBe(INBOUND_REPLY_TEXT_MAX_LENGTH);

    // A cut that lands on a space: the stores re-admit the text and refuse it if that changes it.
    const spaced = `${"a".repeat(INBOUND_REPLY_TEXT_MAX_LENGTH - 1)} tail`;
    const cut = admitInboundReplyText(spaced);
    expect(cut).not.toBeNull();
    expect(admitInboundReplyText(cut ?? "")).toBe(cut);
  });
});

describe("reply identifiers", () => {
  it("replays the same carrier message onto the same id, per plan, and never embeds the message id", () => {
    const first = inboundReplyIdFor(planId("PLAN-1"), "carrier-abc");
    expect(inboundReplyIdFor(planId("PLAN-1"), "carrier-abc")).toBe(first);
    expect(inboundReplyIdFor(planId("PLAN-2"), "carrier-abc")).not.toBe(first);
    expect(first).not.toContain("carrier");
    expect(isInboundReplyId(first)).toBe(true);
  });

  it("makes a fresh id when the carrier names no message, so a genuine second STOP is not a replay", () => {
    const a = inboundReplyIdFor(planId("PLAN-1"), null);
    const b = inboundReplyIdFor(planId("PLAN-1"), null);
    expect(a).not.toBe(b);
    expect(isInboundReplyId(a)).toBe(true);
  });

  it("refuses ids that are not reply ids", () => {
    for (const bad of ["reply-", "reply-short", "0412345678", "reply-has spaces here", "REPLY-abcdefgh"]) {
      expect(isInboundReplyId(bad)).toBe(false);
    }
  });
});

describe("choosePlansForInboundReply", () => {
  const match = (plan: string, patient: string, state: InboundReplyPlanMatch["planState"], created: string) => ({
    planId: planId(plan),
    patientId: patientId(patient),
    planState: state,
    createdAt: new Date(created),
  });

  it("files one item per patient: the open plan, else the most recent", () => {
    const chosen = choosePlansForInboundReply([
      match("P-OLD", "PAT-1", "completed", "2026-01-01T00:00:00Z"),
      match("P-OPEN", "PAT-1", "active", "2025-01-01T00:00:00Z"),
      match("P-A", "PAT-2", "withdrawn", "2026-01-01T00:00:00Z"),
      match("P-B", "PAT-2", "completed", "2026-03-01T00:00:00Z"),
    ]);
    expect(chosen.map((entry) => entry.planId)).toEqual(["P-B", "P-OPEN"]);
  });

  it("files for every patient sharing a number", () => {
    const chosen = choosePlansForInboundReply([
      match("P-1", "PAT-1", "active", "2026-01-01T00:00:00Z"),
      match("P-2", "PAT-2", "active", "2026-01-01T00:00:00Z"),
    ]);
    expect(chosen).toHaveLength(2);
  });
});

describe("the pause and follow-up rules", () => {
  it("pauses only an ACTIVE plan, and only on an opt-out", () => {
    expect(optOutPausesPlan("optOutRequest", "active")).toBe(true);
    for (const state of ["draft", "paused", "withdrawn", "cancelled", "completed"] as const) {
      expect(optOutPausesPlan("optOutRequest", state)).toBe(false);
    }
    expect(optOutPausesPlan("reply", "active")).toBe(false);
  });

  it("refuses a malformed recording before storage", () => {
    const base = { planId: planId("PLAN-1"), replyId: inboundReplyIdFor(planId("PLAN-1"), "m"), text: "hi" };
    expect(admitRecordInboundReplyInput({ ...base, kind: "reply" }).ok).toBe(true);
    expect(admitRecordInboundReplyInput({ ...base, kind: "reply", text: " hi " })).toEqual({
      ok: false,
      reason: INBOUND_REPLY_REFUSALS.invalidReply,
    });
    expect(admitRecordInboundReplyInput({ ...base, kind: "unsubscribe" as unknown as "reply" })).toEqual({
      ok: false,
      reason: INBOUND_REPLY_REFUSALS.invalidReply,
    });
  });

  it("follows up once, and records who and when", () => {
    const record: InboundReplyRecord = {
      id: "reply-abcdefgh",
      planId: planId("PLAN-1"),
      patientId: patientId("PAT-1"),
      teamId: teamId("TEAM-A"),
      kind: "reply",
      receivedAt: new Date("2026-03-01T00:00:00Z"),
      planPaused: false,
      followedUpAt: null,
      followedUpBy: null,
      version: 1,
    };
    const at = new Date("2026-03-02T00:00:00Z");
    const followed = applyInboundReplyFollowUp(record, "ACTOR-1" as never, at);
    expect(followed).toEqual({ ok: true, value: { ...record, followedUpAt: at, followedUpBy: "ACTOR-1", version: 2 } });
    if (!followed.ok) throw new Error("expected a follow-up");
    expect(applyInboundReplyFollowUp(followed.value, "ACTOR-2" as never, at)).toEqual({
      ok: false,
      reason: INBOUND_REPLY_REFUSALS.alreadyFollowedUp,
    });
  });
});

describe("the recorder system role", () => {
  it("may record a reply and nothing else a person does", () => {
    const { reader, recorder } = inboundReplyActorsForTeam(teamId("TEAM-A"));
    const own = { teamId: teamId("TEAM-A") };
    expect(canPerformCaringContactAction(recorder, "recordInboundReply", own).allowed).toBe(true);
    for (const action of [
      "followUpInboundReply",
      "pausePlan",
      "withdrawPlan",
      "resumePlan",
      "generateClinicalRecordSummary",
    ] as const) {
      expect(canPerformCaringContactAction(recorder, action, own).allowed, action).toBe(false);
    }
    expect(canPerformCaringContactAction(recorder, "recordInboundReply", { teamId: teamId("TEAM-B") }).allowed).toBe(
      false,
    );
    // The reader is a human-shaped actor only so the store's read gate can be asked; no person holds it.
    expect(canPerformCaringContactAction(reader, "recordInboundReply", own).allowed).toBe(false);
  });
});

describe("inboundSenderKey", () => {
  it("is a keyed digest that names nobody without the secret", () => {
    const key = inboundSenderKey("+61491570156", "s".repeat(40));
    expect(key).toMatch(INBOUND_SENDER_KEY_PATTERN);
    expect(key).not.toContain("491570156");
    expect(inboundSenderKey("+61491570156", "s".repeat(40))).toBe(key);
    expect(inboundSenderKey("+61491570156", "t".repeat(40))).not.toBe(key);
    expect(inboundSenderKey("+61491570157", "s".repeat(40))).not.toBe(key);
  });
});

describe("the automatic reply", () => {
  it("fits one standard SMS segment", () => {
    expect(INBOUND_AUTO_REPLY_GSM7.valid).toBe(true);
    expect(INBOUND_AUTO_REPLY_GSM7.segments).toBe(1);
  });

  it("names 000, Lifeline and both MHERL numbers exactly as the crisis-lines register holds them", () => {
    const register = readFileSync(path.join(process.cwd(), "docs", "caring-contacts-crisis-lines.md"), "utf8");
    for (const number of ["000", "13 11 14", "1300 555 788", "1800 676 822"]) {
      expect(INBOUND_AUTO_REPLY_MESSAGE).toContain(number);
      expect(register).toContain(`\`${number}\``);
    }
    expect(INBOUND_AUTO_REPLY_MESSAGE).toMatch(/Lifeline/);
    expect(INBOUND_AUTO_REPLY_MESSAGE).toMatch(/Mental Health Emergency Response Line/);
  });

  it("makes no promise and asks nothing", () => {
    expect(INBOUND_AUTO_REPLY_MESSAGE).not.toMatch(/\?|will call|will contact|someone will|we will/i);
    expect(INBOUND_AUTO_REPLY_MESSAGE).not.toMatch(/stop|paused|unsubscribed/i);
  });

  it("is written into the message review pack for sign-off", () => {
    const pack = readFileSync(path.join(process.cwd(), "docs", "caring-contacts", "message-review-pack.md"), "utf8");
    expect(pack).toContain(INBOUND_AUTO_REPLY_MESSAGE);
  });
});

describe("parseInboundTextMessage", () => {
  it("reads the sender, the words and the carrier's message id", () => {
    expect(parseInboundTextMessage({ from: "+61491570156", messageContent: "STOP", messageId: "m-1" })).toEqual({
      from: "+61491570156",
      text: "STOP",
      carrierMessageId: "m-1",
    });
    expect(parseInboundTextMessage({ from: " 0491 570 156 ", body: "hi" })).toEqual({
      from: "0491 570 156",
      text: "hi",
      carrierMessageId: null,
    });
    expect(parseInboundTextMessage({ from: "0491570156", text: "", id: "x" })?.text).toBe("");
  });

  it.each([
    ["not an object", "STOP"],
    ["an array", [{ from: "0491570156", body: "hi" }]],
    ["null", null],
    ["no sender", { body: "hi" }],
    ["an over-long sender", { from: "0".repeat(40), body: "hi" }],
    ["no text field", { from: "0491570156" }],
    ["text fields that disagree", { from: "0491570156", body: "STOP", text: "hello" }],
    ["a non-string message id", { from: "0491570156", body: "hi", messageId: 7 }],
    ["an over-long message id", { from: "0491570156", body: "hi", messageId: "x".repeat(200) }],
  ])("refuses %s", (_label, raw) => {
    expect(parseInboundTextMessage(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The receiver, against a real in-memory store.
// ---------------------------------------------------------------------------

const TEAM = teamId("TEAM-NORTH");
const SECRET = "k".repeat(40);
const ROWAN = "+61491570156";

async function storeWithPlans(): Promise<{
  store: CaringContactRepository;
  active: string;
  withdrawn: string;
}> {
  // Built through the demo seed's own shape is too broad here; one team, two patients, one number.
  const { createDemoWorkspaceStore } = await import("@/lib/caring-contacts-server/demo-seed");
  const store = await createDemoWorkspaceStore(fixedClock("2026-09-26T02:00:00.000Z"));
  const { DEMO_TEAM_ID, demoActorForRole } = await import("@/lib/caring-contacts-server/session");
  expect(DEMO_TEAM_ID).toBeTruthy();
  const plans = await store.listPlans({ actor: demoActorForRole("coordinator") });
  const active = plans.find((record) => record.plan.id === "demo-seed-plan-rowan");
  const withdrawn = plans.find((record) => record.plan.id === "demo-seed-plan-ari");
  if (!active || !withdrawn) throw new Error("demo seed changed: expected the Rowan and Ari plans");
  return { store, active: active.plan.id, withdrawn: withdrawn.plan.id };
}

function recordingTransport(overrides: Partial<MessageTransport> = {}) {
  const sent: OutboundTextMessage[] = [];
  const transport: MessageTransport = {
    kind: "simulated",
    reachesRealPhones: false,
    async send(message) {
      sent.push(message);
      return { outcome: "accepted", providerMessageId: null };
    },
    ...overrides,
  };
  return { transport, sent };
}

describe("receiveInboundTextMessage", () => {
  it("pauses the active plan, files the withdrawn one, and sends the fixed reply once", async () => {
    const { store, active, withdrawn } = await storeWithPlans();
    const { DEMO_TEAM_ID, demoActorForRole } = await import("@/lib/caring-contacts-server/session");
    const { transport, sent } = recordingTransport();
    const senderKey = inboundSenderKey(ROWAN, SECRET);

    const report = await receiveInboundTextMessage({
      store,
      transport,
      teamIds: [DEMO_TEAM_ID],
      message: { from: "0491 570 156", text: "Stop, I can't do this anymore", carrierMessageId: "c-1" },
      senderKey,
    });

    expect(report).toEqual({
      kind: "optOutRequest",
      recorded: 2,
      plansPaused: 1,
      recordingFailed: false,
      failures: [],
      autoReply: "sent",
    });
    const coordinator = demoActorForRole("coordinator");
    expect((await store.getPlan(planId(active), { actor: coordinator }))?.plan.state).toBe("paused");
    expect((await store.getPlan(planId(withdrawn), { actor: coordinator }))?.plan.state).toBe("withdrawn");
    const open = await store.listOpenInboundReplies({ actor: coordinator });
    expect(open.map((reply) => reply.planId).sort()).toEqual([active, withdrawn].sort());
    expect(sent).toEqual([
      { to: ROWAN, body: INBOUND_AUTO_REPLY_MESSAGE, reference: "inbound-auto-reply", deliveryReceiptUrl: null },
    ]);
    // The report is logged by the route: it names no number and no words.
    expect(JSON.stringify(report)).not.toMatch(/491|570|can't/);

    // The carrier retries the same message: nothing new is filed and no second reply goes out.
    const retry = await receiveInboundTextMessage({
      store,
      transport,
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "Stop, I can't do this anymore", carrierMessageId: "c-1" },
      senderKey,
    });
    expect(retry).toMatchObject({ recorded: 2, plansPaused: 1, autoReply: "rateLimited", recordingFailed: false });
    expect(await store.listOpenInboundReplies({ actor: coordinator })).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("answers an unknown number and records nothing about it", async () => {
    const store = createInMemoryRepository(fixedClock("2026-09-26T02:00:00.000Z"));
    const { transport, sent } = recordingTransport();
    const report = await receiveInboundTextMessage({
      store,
      transport,
      teamIds: [TEAM],
      message: { from: "+61400000001", text: "who is this", carrierMessageId: null },
      senderKey: inboundSenderKey("+61400000001", SECRET),
    });
    expect(report).toMatchObject({ kind: "reply", recorded: 0, autoReply: "sent" });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing to a number that is not an Australian mobile, and records nothing", async () => {
    const store = createInMemoryRepository(fixedClock("2026-09-26T02:00:00.000Z"));
    const { transport, sent } = recordingTransport();
    const report = await receiveInboundTextMessage({
      store,
      transport,
      teamIds: [TEAM],
      message: { from: "+14155550100", text: "STOP", carrierMessageId: null },
      senderKey: inboundSenderKey("+14155550100", SECRET),
    });
    expect(report).toMatchObject({ recorded: 0, autoReply: "notSent", autoReplyReason: "not-an-australian-mobile" });
    expect(sent).toEqual([]);
  });

  it("never lets a real carrier text an invented number", async () => {
    const { store } = await storeWithPlans();
    const { DEMO_TEAM_ID } = await import("@/lib/caring-contacts-server/session");
    const { transport, sent } = recordingTransport({ kind: "telstra", reachesRealPhones: true });
    const report = await receiveInboundTextMessage({
      store,
      transport,
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "hello", carrierMessageId: "c-2" },
      senderKey: inboundSenderKey(ROWAN, SECRET),
    });
    expect(report).toMatchObject({ recorded: 2, autoReply: "notSent", autoReplyReason: "fictional-recipient" });
    expect(sent).toEqual([]);
  });

  it("still files the reply when the automatic reply cannot be sent, and sends nothing without the loop guard", async () => {
    const { store } = await storeWithPlans();
    const { DEMO_TEAM_ID } = await import("@/lib/caring-contacts-server/session");
    const { transport, sent } = recordingTransport();
    const broken: CaringContactRepository = Object.create(store, {
      claimInboundAutoReply: {
        value: async () => {
          throw new Error("loop guard down");
        },
      },
    });
    const report = await receiveInboundTextMessage({
      store: broken,
      transport,
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "hello", carrierMessageId: "c-3" },
      senderKey: inboundSenderKey(ROWAN, SECRET),
    });
    expect(report).toMatchObject({ recorded: 2, autoReply: "notSent" });
    expect(report.autoReplyReason).toMatch(/^loop-guard-unavailable/);
    expect(sent).toEqual([]);

    const none = await receiveInboundTextMessage({
      store,
      transport: null,
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "hello again", carrierMessageId: "c-4" },
      senderKey: inboundSenderKey(ROWAN, SECRET),
    });
    expect(none).toMatchObject({ recorded: 2, autoReply: "notSent", autoReplyReason: "transport-unavailable" });
  });

  it("asks for a retry only when a store write THREW", async () => {
    const { store } = await storeWithPlans();
    const { DEMO_TEAM_ID } = await import("@/lib/caring-contacts-server/session");
    const throwing: CaringContactRepository = Object.create(store, {
      recordInboundReply: {
        value: async () => {
          throw new Error("database unavailable");
        },
      },
    });
    const report = await receiveInboundTextMessage({
      store: throwing,
      transport: createSimulatedTransport(),
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "STOP", carrierMessageId: "c-5" },
      senderKey: inboundSenderKey(ROWAN, SECRET),
    });
    expect(report).toMatchObject({ recordingFailed: true, recorded: 0, autoReply: "sent" });
    expect(report.failures).toEqual(["Error"]);
  });

  it("files nothing for a blank message but still answers it", async () => {
    const { store } = await storeWithPlans();
    const { DEMO_TEAM_ID } = await import("@/lib/caring-contacts-server/session");
    const report = await receiveInboundTextMessage({
      store,
      transport: createSimulatedTransport(),
      teamIds: [DEMO_TEAM_ID],
      message: { from: ROWAN, text: "   ", carrierMessageId: null },
      senderKey: inboundSenderKey(ROWAN, SECRET),
    });
    expect(report).toMatchObject({ kind: null, recorded: 0, failures: ["blank-message"], autoReply: "sent" });
  });
});
