// The scheduled sender (src/lib/caring-contacts/sender.ts) against the in-memory reference store,
// populated through the demo seed's real pathway lifecycle plus two plans added here. Nothing in
// this file can reach a phone: every transport is the simulated one or a hand-built fake.
import { describe, expect, it } from "vitest";

import { createDemoWorkspaceStore, DEMO_SEED_PATHWAY_VERSION_ID } from "@/lib/caring-contacts-server/demo-seed";
import { DEMO_TEAM_ID, demoActorForRole } from "@/lib/caring-contacts-server/session";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import type { Clock } from "@/lib/caring-contacts/clock";
import {
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  type PlanId,
} from "@/lib/caring-contacts/ids";
import type { CaringContactRepository, StoredContact } from "@/lib/caring-contacts/repository";
import { recordDeliveryReceipt, runContactSender, type SenderRunReport } from "@/lib/caring-contacts/sender";
import { providerStatusFromCarrier } from "@/lib/caring-contacts/transport/delivery-receipts";
import { createSimulatedTransport } from "@/lib/caring-contacts/transport/simulated";
import type {
  MessageTransport,
  OutboundTextMessage,
  TextMessageSendResult,
} from "@/lib/caring-contacts/transport/types";

const coordinator = demoActorForRole("coordinator");
// 08:00 AWST on a Monday. The added plans are discharged now, morning preference (10:00 AWST).
const START = new Date("2026-10-05T00:00:00Z");

type Harness = {
  store: CaringContactRepository;
  setNow: (instant: Date) => void;
  clock: Clock;
  plans: { kai: PlanId; tui: PlanId };
  contacts: (plan: PlanId) => Promise<StoredContact[]>;
};

let keyCounter = 0;
const key = (label: string) => idempotencyKey(`sender-test-${label}-${(keyCounter += 1)}`);

async function harness(): Promise<Harness> {
  let current = START;
  const clock: Clock = { now: () => new Date(current.getTime()) };
  const store = await createDemoWorkspaceStore(clock);
  const version = pathwayVersionId(DEMO_SEED_PATHWAY_VERSION_ID);

  async function addPlan(name: string, preferredName: string, mobile: string): Promise<PlanId> {
    const referral = referralId(`sender-test-referral-${name}`);
    const patient = patientId(`sender-test-patient-${name}`);
    const created = await store.createReferral(
      { referralId: referral, patientId: patient },
      { actor: coordinator, idempotencyKey: key("ref") },
    );
    if (!created.ok) throw new Error(created.reason);
    const accepted = await store.transitionReferral(
      { referralId: referral, action: { type: "accept", pathwayVersionId: version } },
      { actor: coordinator, idempotencyKey: key("accept") },
    );
    if (!accepted.ok) throw new Error(accepted.reason);
    const id = planId(`sender-test-plan-${name}`);
    const plan = await store.createPlan(
      {
        planId: id,
        referralId: referral,
        patientId: patient,
        pathwayVersionId: version,
        dischargeAt: START,
        sendingPreference: "morning",
        assurances: PLAN_ASSURANCE_VALUES,
        patientDetail: {
          patientName: `${preferredName} Testperson`,
          preferredName,
          patientMobileNumber: mobile,
          patientIdentifiers: [`SYN-SENDER-${name.toUpperCase()}`],
          culturalIdentity: "Not stated",
        },
      },
      { actor: coordinator, idempotencyKey: key("plan") },
    );
    if (!plan.ok) throw new Error(plan.reason);
    const active = await store.activatePlan(
      { planId: id, expectedVersion: plan.value.plan.version },
      { actor: coordinator, idempotencyKey: key("activate") },
    );
    if (!active.ok) throw new Error(active.reason);
    return id;
  }

  const kai = await addPlan("kai", "Kai", "0412 345 678");
  const tui = await addPlan("tui", "Tui", "+61 423 456 789");
  return {
    store,
    clock,
    setNow: (instant) => (current = instant),
    plans: { kai, tui },
    contacts: (plan) => store.listContacts(plan, { actor: coordinator }),
  };
}

async function contactByLabel(h: Harness, plan: PlanId, label: string): Promise<StoredContact> {
  const found = (await h.contacts(plan)).find((stored) => stored.planned.cadenceLabel === label);
  if (!found) throw new Error(`no ${label}`);
  return found;
}

function forPlans(report: SenderRunReport, plans: readonly PlanId[]) {
  return report.outcomes.filter((outcome) => plans.includes(outcome.planId));
}

const minutes = (n: number) => n * 60_000;

describe("the scheduled sender", () => {
  it("sends nothing before a contact is due, including the one-minute dispatch delay", async () => {
    const h = await harness();
    const day1 = await contactByLabel(h, h.plans.kai, "Day 1");
    h.setNow(new Date(day1.planned.sendAt.getTime() + 30_000));
    const transport = createSimulatedTransport();
    const report = await runContactSender({ store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] });
    expect(forPlans(report, [h.plans.kai, h.plans.tui])).toEqual([]);
    expect(transport.records).toHaveLength(0);
  });

  it("never sends made-up text: a message type the pathway has no wording for is marked for review", async () => {
    const h = await harness();
    const day1 = await contactByLabel(h, h.plans.kai, "Day 1");
    expect(day1.planned.messageType).toBe("first");
    h.setNow(new Date(day1.planned.sendAt.getTime() + minutes(2)));
    const transport = createSimulatedTransport();
    const report = await runContactSender({ store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] });

    const mine = forPlans(report, [h.plans.kai, h.plans.tui]);
    expect(mine).toHaveLength(2);
    for (const outcome of mine) {
      expect(outcome.outcome).toBe("needsReview");
      expect(outcome.reason).toBe("message-body-not-authored");
    }
    expect(transport.records).toHaveLength(0);
    expect((await contactByLabel(h, h.plans.kai, "Day 1")).contact.state).toBe("missed");
  });

  it("sends each patient the governed message with their OWN preferred name, never the specimen's", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const bodies = new Map<string, OutboundTextMessage>();
    const transport = createSimulatedTransport({
      outcome: (message) => {
        bodies.set(message.reference, message);
        return { outcome: "accepted", providerMessageId: null, status: "delivered" };
      },
    });
    const report = await runContactSender({ store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] });

    const sent = forPlans(report, [h.plans.kai, h.plans.tui]).filter((outcome) => outcome.outcome === "sent");
    expect(sent).toHaveLength(2);
    const kaiMessage = bodies.get(week1.contact.id);
    const tuiMessage = bodies.get((await contactByLabel(h, h.plans.tui, "Week 1")).contact.id);
    expect(kaiMessage?.body.startsWith("Hi Kai, ")).toBe(true);
    expect(tuiMessage?.body.startsWith("Hi Tui, ")).toBe(true);
    expect(kaiMessage?.body).not.toContain("Rowan");
    expect(kaiMessage?.body).not.toContain("{preferredName}");
    expect(kaiMessage?.to).toBe("+61412345678");
    expect(tuiMessage?.to).toBe("+61423456789");
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("delivered");
    // The earlier Day 1 contact's window had closed by then: recorded missed, never sent late.
    expect((await contactByLabel(h, h.plans.kai, "Day 1")).contact.state).toBe("missed");
    expect(forPlans(report, [h.plans.kai]).some((o) => o.outcome === "missedWindowClosed")).toBe(true);
  });

  it("sends each contact at most once when two runs overlap or a run is repeated", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const transport = createSimulatedTransport();
    const input = { store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] };
    const [first, second] = await Promise.all([runContactSender(input), runContactSender(input)]);
    const third = await runContactSender(input);

    const week1Ids = new Set([week1.contact.id, (await contactByLabel(h, h.plans.tui, "Week 1")).contact.id]);
    const sends = transport.records.filter((record) => week1Ids.has(record.reference as never));
    expect(sends).toHaveLength(2);
    const sentOutcomes = [...first.outcomes, ...second.outcomes, ...third.outcomes].filter(
      (outcome) => week1Ids.has(outcome.contactId) && outcome.outcome === "sent",
    );
    expect(sentOutcomes).toHaveLength(2);
  });

  it("lets exactly one of two runs that read the same contact claim it (the store's dispatch-start is the claim)", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    // Hold every run's sendable read for Kai's plan until both runs have made it, so both hold the
    // same contact version when they try to claim -- the worst interleaving for a double send.
    let waiting: (() => void)[] = [];
    const barrierStore: CaringContactRepository = Object.create(h.store);
    barrierStore.listSendableContacts = async (plan, context) => {
      const result = await h.store.listSendableContacts(plan, context);
      if (plan !== h.plans.kai) return result;
      await new Promise<void>((resolve) => {
        waiting.push(resolve);
        if (waiting.length === 2) {
          waiting.forEach((release) => release());
          waiting = [];
        }
      });
      return result;
    };
    const transport = createSimulatedTransport();
    const input = { store: barrierStore, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] };
    const reports = await Promise.all([runContactSender(input), runContactSender(input)]);
    const kaiWeek1 = reports.flatMap((r) => r.outcomes).filter((o) => o.contactId === week1.contact.id);
    expect(kaiWeek1.map((o) => o.outcome).sort()).toEqual(["notClaimed", "sent"]);
    expect(transport.records.filter((r) => r.reference === week1.contact.id)).toHaveLength(1);
  });

  it("sends nothing while the service safety stop is raised", async () => {
    const h = await harness();
    const stopped = await h.store.stopService(
      { reason: "duplicate-send", note: "sender test" },
      { actor: coordinator, idempotencyKey: key("stop") },
    );
    expect(stopped.ok).toBe(true);
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const transport = createSimulatedTransport();
    const report = await runContactSender({ store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] });
    expect(report.serviceStopped).toBe(true);
    expect(report.outcomes).toEqual([]);
    expect(transport.records).toHaveLength(0);
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("scheduled");
  });

  it("sends nothing for a paused plan and leaves its contacts untouched", async () => {
    const h = await harness();
    const plan = await h.store.getPlan(h.plans.kai, { actor: coordinator });
    const paused = await h.store.pausePlan(
      { planId: h.plans.kai, expectedVersion: plan!.plan.version },
      { actor: coordinator, idempotencyKey: key("pause") },
    );
    expect(paused.ok).toBe(true);
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const report = await runContactSender({
      store: h.store,
      transport: createSimulatedTransport(),
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect(forPlans(report, [h.plans.kai])).toEqual([]);
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("scheduled");
  });

  it("records a carrier refusal as not sent and an ambiguous answer as status unavailable, never re-sending", async () => {
    const h = await harness();
    const kaiWeek1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(kaiWeek1.planned.sendAt.getTime() + minutes(2)));
    const transport = createSimulatedTransport({
      outcome: (message): TextMessageSendResult =>
        message.reference === kaiWeek1.contact.id
          ? { outcome: "rejected", reason: "carrier-refused-400" }
          : { outcome: "unknown", reason: "carrier-timeout" },
    });
    const input = { store: h.store, transport, clock: h.clock, teamIds: [DEMO_TEAM_ID] };
    const report = await runContactSender(input);
    const kinds = forPlans(report, [h.plans.kai, h.plans.tui]).map((o) => o.outcome);
    expect(kinds).toContain("notSentCarrierRefused");
    expect(kinds).toContain("sentStatusUnknown");
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("missed");
    expect((await contactByLabel(h, h.plans.tui, "Week 1")).contact.state).toBe("statusUnavailable");

    const before = transport.records.length;
    await runContactSender(input);
    expect(transport.records.length).toBe(before);
  });

  it("with a transport that reaches real phones, refuses the prototype's fictional wording", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const sends: OutboundTextMessage[] = [];
    const realLike: MessageTransport = {
      kind: "telstra",
      reachesRealPhones: true,
      async send(message) {
        sends.push(message);
        return { outcome: "accepted", providerMessageId: "x" };
      },
    };
    const report = await runContactSender({
      store: h.store,
      transport: realLike,
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    const week1Outcomes = forPlans(report, [h.plans.kai, h.plans.tui]).filter((o) => o.sequence === 2);
    expect(week1Outcomes.map((o) => o.reason)).toEqual([
      "fictional-contact-detail-present",
      "fictional-contact-detail-present",
    ]);
    expect(sends).toHaveLength(0);
  });

  it("sends nothing for a team it was not given", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const transport = createSimulatedTransport();
    const report = await runContactSender({ store: h.store, transport, clock: h.clock, teamIds: [] });
    expect(report.outcomes).toEqual([]);
    expect(transport.records).toHaveLength(0);
  });
});

describe("delivery receipts", () => {
  async function sentButAwaitingReceipt() {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    await runContactSender({
      store: h.store,
      transport: createSimulatedTransport({ outcome: () => ({ outcome: "accepted", providerMessageId: "m-1" }) }),
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("sent");
    return { h, contactId: week1.contact.id };
  }

  it("records a final receipt once, and a repeat or an interim status changes nothing", async () => {
    const { h, contactId } = await sentButAwaitingReceipt();
    const receipt = (status: string) =>
      recordDeliveryReceipt({
        store: h.store,
        teamId: DEMO_TEAM_ID,
        planId: h.plans.kai,
        contactId,
        status: providerStatusFromCarrier(status),
      });
    expect(await receipt("queued")).toBe("interimStatusIgnored");
    expect(await receipt("delivered")).toBe("recorded");
    expect(await receipt("delivered")).toBe("duplicate");
    expect(await receipt("undeliverable")).toBe("alreadyFinal");
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("delivered");
  });

  it("maps a carrier's failure words to not delivered", async () => {
    const { h, contactId } = await sentButAwaitingReceipt();
    const result = await recordDeliveryReceipt({
      store: h.store,
      teamId: DEMO_TEAM_ID,
      planId: h.plans.kai,
      contactId,
      status: providerStatusFromCarrier("EXPIRED"),
    });
    expect(result).toBe("recorded");
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("notDelivered");
  });

  it("with a real carrier, records status unavailable when no receipt arrives within a day", async () => {
    const { h } = await sentButAwaitingReceipt();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + 25 * 60 * minutes(1)));
    const realLike: MessageTransport = {
      kind: "telstra",
      reachesRealPhones: true,
      send: async () => ({ outcome: "rejected", reason: "not-used" }),
    };
    const report = await runContactSender({
      store: h.store,
      transport: realLike,
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect(forPlans(report, [h.plans.kai]).some((o) => o.outcome === "receiptTimedOut")).toBe(true);
    expect((await contactByLabel(h, h.plans.kai, "Week 1")).contact.state).toBe("statusUnavailable");
  });
});

// Staff alert delivery: the sender's two new behaviours. A carrier "too many requests" stops the
// run claiming more contacts (so a throttle does not become a string of missed caring messages),
// and every completed run leaves a heartbeat the readiness probe reads.
describe("the scheduled sender under carrier rate limiting", () => {
  it("stops claiming for the rest of the run, leaving the other due contacts scheduled for the next run", async () => {
    const h = await harness();
    const week1 = await contactByLabel(h, h.plans.kai, "Week 1");
    h.setNow(new Date(week1.planned.sendAt.getTime() + minutes(2)));
    const throttled = createSimulatedTransport({
      outcome: () => ({ outcome: "rejected", reason: "carrier-rate-limited" }),
    });
    const report = await runContactSender({
      store: h.store,
      transport: throttled,
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });

    expect(report.carrierRateLimited).toBe(true);
    // Exactly one send was attempted, however many contacts were due.
    expect(throttled.records).toHaveLength(1);
    const limited = report.outcomes.filter((outcome) => outcome.reason === "carrier-rate-limited");
    expect(limited).toHaveLength(1);
    expect(limited[0].outcome).toBe("notSentCarrierRefused");

    const week1Ids = [week1.contact.id, (await contactByLabel(h, h.plans.tui, "Week 1")).contact.id];
    const states = await Promise.all(
      [h.plans.kai, h.plans.tui].map(async (plan) => (await contactByLabel(h, plan, "Week 1")).contact.state),
    );
    expect(states.filter((state) => state === "scheduled").length).toBeGreaterThanOrEqual(1);

    // The next run, with the carrier answering again, sends what was left -- and never re-sends the
    // one the carrier refused (it is recorded missed for a person to review).
    const accepting = createSimulatedTransport();
    await runContactSender({ store: h.store, transport: accepting, clock: h.clock, teamIds: [DEMO_TEAM_ID] });
    expect(accepting.records.map((record) => record.reference)).not.toContain(limited[0].contactId);
    for (const id of week1Ids) {
      if (id === limited[0].contactId) continue;
      const plan = id === week1.contact.id ? h.plans.kai : h.plans.tui;
      expect((await contactByLabel(h, plan, "Week 1")).contact.state).toBe("delivered");
    }
  });
});

describe("the sender heartbeat", () => {
  it("is recorded by every completed run: nothing due, and a stopped service", async () => {
    const h = await harness();
    const day1 = await contactByLabel(h, h.plans.kai, "Day 1");
    h.setNow(new Date(day1.planned.sendAt.getTime() - minutes(30)));
    expect(await h.store.getSenderHeartbeat({ actor: coordinator })).toBeNull();

    const quiet = await runContactSender({
      store: h.store,
      transport: createSimulatedTransport(),
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect(quiet.heartbeatRecorded).toBe(true);
    expect((await h.store.getSenderHeartbeat({ actor: coordinator }))?.lastRunAt).toEqual(h.clock.now());

    const stopped = await h.store.stopService(
      { reason: "duplicate-send", note: "heartbeat test" },
      { actor: coordinator, idempotencyKey: key("stop") },
    );
    expect(stopped.ok).toBe(true);
    h.setNow(new Date(day1.planned.sendAt.getTime() - minutes(20)));
    const halted = await runContactSender({
      store: h.store,
      transport: createSimulatedTransport(),
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect(halted.serviceStopped).toBe(true);
    expect(halted.heartbeatRecorded).toBe(true);
    expect((await h.store.getSenderHeartbeat({ actor: coordinator }))?.lastRunAt).toEqual(h.clock.now());
  });

  it("is not recorded when the sender works for no team, or when the run fails outright", async () => {
    const h = await harness();
    const none = await runContactSender({
      store: h.store,
      transport: createSimulatedTransport(),
      clock: h.clock,
      teamIds: [],
    });
    expect(none.heartbeatRecorded).toBe(false);

    const broken: CaringContactRepository = Object.create(h.store);
    broken.getServiceState = async () => {
      throw new Error("database unavailable");
    };
    await expect(
      runContactSender({
        store: broken,
        transport: createSimulatedTransport(),
        clock: h.clock,
        teamIds: [DEMO_TEAM_ID],
      }),
    ).rejects.toThrow("database unavailable");
    expect(await h.store.getSenderHeartbeat({ actor: coordinator })).toBeNull();
  });

  it("reports a refused heartbeat write without failing the run", async () => {
    const h = await harness();
    const refusing: CaringContactRepository = Object.create(h.store);
    refusing.recordSenderHeartbeat = async () => {
      throw new Error("heartbeat table missing");
    };
    const report = await runContactSender({
      store: refusing,
      transport: createSimulatedTransport(),
      clock: h.clock,
      teamIds: [DEMO_TEAM_ID],
    });
    expect(report.heartbeatRecorded).toBe(false);
  });
});
