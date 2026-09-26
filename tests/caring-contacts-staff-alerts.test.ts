// Staff alert delivery (src/lib/caring-contacts/alerts/): what an alert may contain, how it leaves
// the app, who it goes to, how often, which sender outcomes raise which alert, and when the sender
// counts as stalled. Nothing here reaches a real channel: the webhook adapter is driven against a
// fake `fetch`, and the store is the in-memory reference store.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AlertDeliveryConfigError,
  clearSimulatedStaffAlertOutbox,
  createSimulatedAlertDelivery,
  createWebhookAlertDelivery,
  resolveStaffAlertDelivery,
  SIMULATED_OUTBOX_LIMIT,
  simulatedStaffAlertOutbox,
  type StaffAlertDelivery,
} from "@/lib/caring-contacts/alerts/delivery";
import { deliverStaffAlerts, staffAlertsActorForTeam, type StaffAlertLog } from "@/lib/caring-contacts/alerts/raise";
import { senderHealth } from "@/lib/caring-contacts/alerts/sender-health";
import { alertsFromSenderRun } from "@/lib/caring-contacts/alerts/sender-run-alerts";
import {
  OPERATIONAL_ALERT_CLASSES,
  staffAlert,
  staffAlertPayload,
  STAFF_ALERT_REASONS,
  type StaffAlert,
  type StaffAlertReason,
} from "@/lib/caring-contacts/alerts/staff-alert";
import { fixedClock, type Clock } from "@/lib/caring-contacts/clock";
import { actorId, contactId, idempotencyKey, planId, teamId } from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { ALERT_CLASSES, type AlertClass } from "@/lib/caring-contacts/notification-preferences";
import type { Actor } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import type { SenderContactOutcome, SenderRunReport } from "@/lib/caring-contacts/sender";

const NORTH = teamId("TEAM-NORTH");
const SOUTH = teamId("TEAM-SOUTH");
const NOW = "2026-03-02T03:00:00.000Z";
const HOUR = 60 * 60 * 1000;
const coordinatorNorth: Actor = { id: actorId("ACTOR-1"), teamId: NORTH, roles: ["coordinator"] };

/** Anything that looks like patient data in the fixtures below. None of it may reach an alert. */
const PATIENT_LEAKS = /Rowan|Mira|\+61|0412|491 570|UR-|PLAN-|CONTACT-|contact-\d/;

beforeEach(() => clearSimulatedStaffAlertOutbox());
afterEach(() => clearSimulatedStaffAlertOutbox());

describe("what a staff alert may contain", () => {
  it("builds a body from the class and count only, plus a fixed reason and a synthetic team", () => {
    const alert = staffAlert({
      alertClass: "permanentDeliveryFailure",
      count: 3,
      reason: "messages-not-sent",
      teamId: NORTH,
    });
    const payload = staffAlertPayload(alert, new Date(NOW));
    expect(payload).toEqual({
      service: "caring-contacts",
      text: "Caring Contacts staff alert: 3 items affected by permanent delivery failure. Reason: messages-not-sent. Team: TEAM-NORTH. Open the workspace to review.",
      alertClass: "permanentDeliveryFailure",
      count: 3,
      reason: "messages-not-sent",
      teamId: "TEAM-NORTH",
      raisedAt: NOW,
    });
  });

  it("refuses a reason outside the closed set, a count below one, and an unlabelled class", () => {
    expect(() =>
      staffAlert({ alertClass: "exceptionBacklog", count: 1, reason: "Rowan's number bounced" as StaffAlertReason }),
    ).toThrow(/not a staff alert reason/);
    expect(() => staffAlert({ alertClass: "exceptionBacklog", count: 0 })).toThrow(/at least 1/);
    expect(() => staffAlert({ alertClass: "exceptionBacklog", count: 1.5 })).toThrow(/whole number/);
    expect(() => staffAlert({ alertClass: "constructor" as AlertClass, count: 1 })).toThrow(/constructor/);
  });

  it("labels every alert class, including the two operational ones added for delivery", () => {
    for (const alertClass of ALERT_CLASSES) {
      const text = staffAlertPayload(staffAlert({ alertClass, count: 1 }), new Date(NOW)).text;
      expect(text).not.toMatch(PATIENT_LEAKS);
      expect(text).toMatch(/^Caring Contacts staff alert: 1 item affected by [a-z ]+\./);
    }
    expect([...OPERATIONAL_ALERT_CLASSES].sort()).toEqual(["carrierRateLimited", "senderStalled", "serviceSafetyStop"]);
  });

  it("holds only fixed, identifier-free reason codes", () => {
    for (const reason of STAFF_ALERT_REASONS) expect(reason).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
});

describe("delivery adapters and their settings", () => {
  const alert = staffAlert({ alertClass: "senderStalled", count: 1, reason: "sender-run-overdue" });

  it("is simulated by default, recording content-free payloads in a bounded outbox", async () => {
    const delivery = resolveStaffAlertDelivery({});
    expect(delivery.kind).toBe("simulated");
    for (let index = 0; index < SIMULATED_OUTBOX_LIMIT + 5; index += 1) {
      expect(await delivery.deliver(alert, new Date(NOW))).toEqual({ ok: true });
    }
    expect(simulatedStaffAlertOutbox()).toHaveLength(SIMULATED_OUTBOX_LIMIT);
    expect(simulatedStaffAlertOutbox()[0].alertClass).toBe("senderStalled");
  });

  it("refuses a half-configured or unsafe real channel instead of quietly simulating", () => {
    expect(() => resolveStaffAlertDelivery({ CARING_CONTACTS_ALERT_DELIVERY: "email" })).toThrow(
      AlertDeliveryConfigError,
    );
    expect(() => resolveStaffAlertDelivery({ CARING_CONTACTS_ALERT_DELIVERY: "webhook" })).toThrow(/is missing/);
    expect(() =>
      resolveStaffAlertDelivery({ CARING_CONTACTS_ALERT_WEBHOOK_URL: "https://hooks.example.gov.au/abc" }),
    ).toThrow(/Set both, or neither/);
    expect(() =>
      resolveStaffAlertDelivery(
        {
          CARING_CONTACTS_ALERT_DELIVERY: "webhook",
          CARING_CONTACTS_ALERT_WEBHOOK_URL: "http://hooks.example.gov.au/abc",
        },
        { nodeEnv: "production" },
      ),
    ).toThrow(/https/);
    expect(() =>
      resolveStaffAlertDelivery(
        { CARING_CONTACTS_ALERT_DELIVERY: "webhook", CARING_CONTACTS_ALERT_WEBHOOK_URL: "http://127.0.0.1:9/hook" },
        { nodeEnv: "production" },
      ),
    ).toThrow(/https/);
    expect(() =>
      resolveStaffAlertDelivery({
        CARING_CONTACTS_ALERT_DELIVERY: "webhook",
        CARING_CONTACTS_ALERT_WEBHOOK_URL: "https://user:pass@hooks.example.gov.au/abc",
      }),
    ).toThrow(/user name or password/);
    // The address is a secret: no refusal repeats it.
    try {
      resolveStaffAlertDelivery({
        CARING_CONTACTS_ALERT_DELIVERY: "webhook",
        CARING_CONTACTS_ALERT_WEBHOOK_URL: "nonsense-secret-token",
      });
    } catch (error) {
      expect(String(error)).not.toContain("secret-token");
    }
    // Positive control.
    expect(
      resolveStaffAlertDelivery({
        CARING_CONTACTS_ALERT_DELIVERY: "webhook",
        CARING_CONTACTS_ALERT_WEBHOOK_URL: "https://hooks.example.gov.au/abc",
      }).kind,
    ).toBe("webhook");
  });

  it("posts one JSON alert to the webhook and reports refusals, timeouts and outages by fixed code", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    let answer: () => Promise<Response> = async () => new Response("ok", { status: 200 });
    const fetchImpl = (async (url: URL | string, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return answer();
    }) as typeof fetch;
    const delivery = createWebhookAlertDelivery("https://hooks.example.gov.au/secret-path", { fetchImpl });

    expect(await delivery.deliver(alert, new Date(NOW))).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.redirect).toBe("error");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      alertClass: "senderStalled",
      count: 1,
      reason: "sender-run-overdue",
      teamId: null,
    });

    answer = async () => new Response(`bad hook for ${"+61412345678"}`, { status: 403 });
    const refused = await delivery.deliver(alert, new Date(NOW));
    expect(refused).toEqual({ ok: false, reason: "webhook-refused-403" });
    expect(JSON.stringify(refused)).not.toMatch(/secret-path|412345678/);

    answer = async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    };
    expect(await delivery.deliver(alert, new Date(NOW))).toEqual({ ok: false, reason: "webhook-timeout" });

    answer = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await delivery.deliver(alert, new Date(NOW))).toEqual({ ok: false, reason: "webhook-unreachable" });
  });
});

describe("delivering a batch of alerts", () => {
  let store: CaringContactRepository;
  let clockAt: number;
  const clock: Clock = { now: () => new Date(clockAt) };
  let lines: Parameters<StaffAlertLog>[];
  const log: StaffAlertLog = (...args) => lines.push(args);

  beforeEach(() => {
    store = createInMemoryRepository(fixedClock(NOW));
    clockAt = new Date(NOW).getTime();
    lines = [];
  });

  const deliver = (alerts: StaffAlert[], delivery: StaffAlertDelivery = createSimulatedAlertDelivery()) =>
    deliverStaffAlerts({ store, delivery, clock, cooldownMs: HOUR, alerts, serviceTeamId: NORTH, log });

  async function optIn(actor: Actor, classes: AlertClass[]) {
    const saved = await store.saveNotificationPreferences(
      { actorId: actor.id, optedIn: classes },
      { actor, idempotencyKey: idempotencyKey(`optin-${actor.id}-${classes.join("-")}`) },
    );
    if (!saved.ok) throw new Error(saved.reason);
  }

  it("delivers a patient-work alert only for a team where somebody opted in to that class", async () => {
    const failure = staffAlert({ alertClass: "permanentDeliveryFailure", count: 2, teamId: NORTH });
    expect((await deliver([failure]))[0].outcome).toBe("notOptedIn");
    expect(simulatedStaffAlertOutbox()).toEqual([]);

    await optIn(coordinatorNorth, ["permanentDeliveryFailure"]);
    const southFailure = staffAlert({ alertClass: "permanentDeliveryFailure", count: 1, teamId: SOUTH });
    const reports = await deliver([failure, southFailure]);
    expect(reports.map((report) => [report.teamId, report.outcome])).toEqual([
      [NORTH, "delivered"],
      [SOUTH, "notOptedIn"],
    ]);
    expect(simulatedStaffAlertOutbox().map((payload) => payload.teamId)).toEqual(["TEAM-NORTH"]);
  });

  it("always delivers the operational alerts, whether or not anybody opted in", async () => {
    const reports = await deliver([
      staffAlert({ alertClass: "senderStalled", count: 1, reason: "sender-never-run" }),
      staffAlert({ alertClass: "carrierRateLimited", count: 1, reason: "carrier-rate-limited" }),
      staffAlert({ alertClass: "serviceSafetyStop", count: 1, reason: "service-stopped" }),
    ]);
    expect(reports.map((report) => report.outcome)).toEqual(["delivered", "delivered", "delivered"]);
    expect(simulatedStaffAlertOutbox().map((payload) => payload.alertClass)).toEqual([
      "senderStalled",
      "carrierRateLimited",
      "serviceSafetyStop",
    ]);
  });

  it("does not re-send the same alert while its condition persists, and sends again after the cooldown", async () => {
    const stalled = staffAlert({ alertClass: "senderStalled", count: 1, reason: "sender-run-overdue" });
    expect((await deliver([stalled]))[0].outcome).toBe("delivered");
    for (const minutesLater of [5, 10, 30, 59]) {
      clockAt = new Date(NOW).getTime() + minutesLater * 60_000;
      expect((await deliver([stalled]))[0].outcome).toBe("coolingDown");
    }
    clockAt = new Date(NOW).getTime() + HOUR;
    expect((await deliver([stalled]))[0].outcome).toBe("delivered");
    expect(simulatedStaffAlertOutbox()).toHaveLength(2);
  });

  it("gives the claim back when delivery fails, so the next attempt is not silenced", async () => {
    const failing: StaffAlertDelivery = {
      kind: "webhook",
      deliver: async () => ({ ok: false, reason: "webhook-refused-500" }),
    };
    const stalled = staffAlert({ alertClass: "senderStalled", count: 1, reason: "sender-run-overdue" });
    expect(await deliver([stalled], failing)).toEqual([
      expect.objectContaining({ outcome: "deliveryFailed", failure: "webhook-refused-500" }),
    ]);
    clockAt += 5 * 60_000;
    expect((await deliver([stalled]))[0].outcome).toBe("delivered");
  });

  it("never throws: a throwing adapter, a failing store and a failing logger are all reported instead", async () => {
    const throwing: StaffAlertDelivery = {
      kind: "webhook",
      deliver: async () => {
        throw new RangeError("adapter bug");
      },
    };
    const stalled = staffAlert({ alertClass: "senderStalled", count: 1 });
    expect((await deliver([stalled], throwing))[0]).toMatchObject({
      outcome: "deliveryFailed",
      failure: "delivery-RangeError",
    });

    const brokenStore: CaringContactRepository = Object.create(store);
    brokenStore.claimStaffAlert = async () => {
      throw new Error("database unavailable");
    };
    const reports = await deliverStaffAlerts({
      store: brokenStore,
      delivery: createSimulatedAlertDelivery(),
      clock,
      cooldownMs: HOUR,
      alerts: [stalled],
      serviceTeamId: NORTH,
      log: () => {
        throw new Error("logger down");
      },
    });
    expect(reports).toEqual([expect.objectContaining({ outcome: "error", failure: "Error" })]);
  });

  it("logs fixed codes only", async () => {
    await optIn(coordinatorNorth, ["exceptionBacklog"]);
    await deliver([
      staffAlert({ alertClass: "exceptionBacklog", count: 4, reason: "outcome-needs-checking", teamId: NORTH }),
    ]);
    expect(lines).toHaveLength(1);
    const [level, message, fields] = lines[0];
    expect(level).toBe("info");
    expect(message).toBe("Caring Contacts staff alert");
    expect(fields).toEqual({
      alertClass: "exceptionBacklog",
      count: 4,
      reason: "outcome-needs-checking",
      teamId: "TEAM-NORTH",
      outcome: "delivered",
      failure: null,
      delivery: "simulated",
    });
  });

  it("does its bookkeeping as a system actor, which a person cannot impersonate", async () => {
    expect(staffAlertsActorForTeam(NORTH)).toEqual({
      id: "system-staff-alerts",
      teamId: NORTH,
      systemRole: "contactDispatcher",
    });
    const refused = await store.claimStaffAlert(
      { scope: "service", alertClass: "senderStalled", at: new Date(NOW), cooldownMs: HOUR },
      { actor: coordinatorNorth },
    );
    expect(refused.ok).toBe(false);
  });
});

describe("which sender outcomes raise which alert", () => {
  const outcome = (
    kind: SenderContactOutcome["outcome"],
    options: { team?: string; reason?: string } = {},
  ): SenderContactOutcome => ({
    teamId: teamId(options.team ?? "TEAM-NORTH"),
    planId: planId("PLAN-ROWAN-1"),
    contactId: contactId("PLAN-ROWAN-1--contact-2"),
    sequence: 2,
    outcome: kind,
    ...(options.reason ? { reason: options.reason } : {}),
  });
  const report = (outcomes: SenderContactOutcome[], extra: Partial<SenderRunReport> = {}): SenderRunReport => ({
    startedAt: NOW,
    transport: "telstra",
    serviceStopped: false,
    carrierRateLimited: false,
    heartbeatRecorded: true,
    outcomes,
    ...extra,
  });

  it("raises nothing for a clean run, a stopped service, or contacts another run claimed", () => {
    expect(alertsFromSenderRun(report([outcome("sent"), outcome("sent"), outcome("notClaimed")]))).toEqual([]);
    expect(alertsFromSenderRun(report([], { serviceStopped: true }))).toEqual([]);
  });

  it("counts refused, unsendable and window-missed contacts as permanent delivery failures, per team", () => {
    const alerts = alertsFromSenderRun(
      report([
        outcome("notSentCarrierRefused", { reason: "carrier-refused-400" }),
        outcome("needsReview", { reason: "mobile-number-not-sendable" }),
        outcome("missedWindowClosed", { team: "TEAM-SOUTH" }),
      ]),
    );
    expect(alerts).toEqual([
      { alertClass: "permanentDeliveryFailure", count: 2, reason: "messages-not-sent", teamId: NORTH },
      { alertClass: "permanentDeliveryFailure", count: 1, reason: "sending-window-missed", teamId: SOUTH },
    ]);
  });

  it("counts uncertain outcomes as an exception backlog, and leaves a mixed reason off", () => {
    const alerts = alertsFromSenderRun(
      report([
        outcome("sentStatusUnknown", { reason: "carrier-timeout" }),
        outcome("sentButNotRecorded"),
        outcome("receiptTimedOut"),
        outcome("error", { reason: "TypeError" }),
        outcome("notSentCarrierRefused"),
        outcome("missedWindowClosed"),
      ]),
    );
    expect(alerts).toEqual([
      { alertClass: "exceptionBacklog", count: 4, reason: "outcome-needs-checking", teamId: NORTH },
      { alertClass: "permanentDeliveryFailure", count: 2, reason: null, teamId: NORTH },
    ]);
  });

  it("raises the operational rate-limiting alert, service-wide, as well as the failed delivery", () => {
    const alerts = alertsFromSenderRun(
      report([outcome("notSentCarrierRefused", { reason: "carrier-rate-limited" })], { carrierRateLimited: true }),
    );
    expect(alerts).toEqual([
      { alertClass: "carrierRateLimited", count: 1, reason: "carrier-rate-limited", teamId: null },
      { alertClass: "permanentDeliveryFailure", count: 1, reason: "messages-not-sent", teamId: NORTH },
    ]);
  });

  it("never carries a plan, contact, carrier reason or patient detail into an alert", () => {
    const alerts = alertsFromSenderRun(
      report([
        outcome("notSentCarrierRefused", { reason: "carrier-refused-400" }),
        outcome("sentStatusUnknown", { reason: "carrier-connection-lost" }),
      ]),
    );
    const text = JSON.stringify(alerts.map((alert) => staffAlertPayload(alert, new Date(NOW))));
    expect(text).not.toMatch(PATIENT_LEAKS);
    expect(text).not.toMatch(/ROWAN|carrier-refused|connection-lost/);
  });
});

describe("when the sender counts as stalled", () => {
  const start = new Date("2026-03-02T00:00:00.000Z");
  const threshold = 15 * 60_000;
  const at = (minutesAfterStart: number) => new Date(start.getTime() + minutesAfterStart * 60_000);
  const health = (lastRunMinutes: number | null, nowMinutes: number, monitored = true) =>
    senderHealth({
      monitored,
      lastRunAt: lastRunMinutes === null ? null : at(lastRunMinutes),
      now: at(nowMinutes),
      processStartedAt: start,
      thresholdMs: threshold,
    });

  it.each([
    // [last run (minutes after start), now, expected status, expected reason]
    [null, 5, "starting", null],
    [null, 15, "starting", null],
    [null, 16, "stalled", "sender-never-run"],
    [10, 20, "running", null],
    [10, 25, "running", null],
    [10, 26, "stalled", "sender-run-overdue"],
    // An old heartbeat from before this process started is inside the start-up grace at first.
    [-120, 10, "starting", null],
    [-120, 16, "stalled", "sender-run-overdue"],
  ] as const)("last run %s, now %s: %s", (lastRun, now, status, reason) => {
    expect(health(lastRun, now)).toEqual({ status, reason });
  });

  it("is never stalled when it is not monitored", () => {
    expect(health(null, 600, false)).toEqual({ status: "notMonitored", reason: null });
  });
});

describe("the alerts identity", () => {
  it("is software, not a person", () => {
    const actor = staffAlertsActorForTeam(NORTH);
    expect("roles" in actor).toBe(false);
    expect(actor.id).toBe(actorId("system-staff-alerts"));
  });
});
