// tests/caring-contacts-schedule-view.test.ts
//
// Phase 2B Task 12 -- the schedule read, derived from what `listPlans` already returns.
//
// Written against the SEALED DOMAIN rather than a route, because everything asserted here is
// arithmetic over values the domain already produced: which sending window an instant falls in,
// which contacts a calendar day holds, and what each contact's state and its plan's state say
// about whether anything goes out. The HTTP boundary that publishes it is pinned separately in
// `tests/caring-contacts-schedule-route.test.ts`.
//
// The fixtures go through `createInMemoryRepository` rather than assembling `PlanRecord`s by hand,
// so every plan under test is one the store could actually hold: the contact states come from the
// real lifecycle writes, and an absorbed Week 1 entry is absorbed by the real planner. The one
// exception is the AWST midnight case, which is unreachable through `buildApprovedSchedule` (the
// approved window starts at 09:00) and is therefore built by hand and labelled as defensive.
import { describe, expect, it } from "vitest";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";

import { awstCalendarDay, fixedClock } from "@/lib/caring-contacts/clock";
import {
  actorId,
  contactId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
  type PlanId,
} from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import type { ContactState, PlanState, SendingPreference } from "@/lib/caring-contacts/model";
import type { Actor, SystemActor } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";
import { SENDING_PREFERENCE_OPTIONS, sendingPreferenceAt } from "@/lib/caring-contacts/schedule";
import {
  buildScheduleRange,
  needsOperationalReview,
  planSendingHold,
  SCHEDULE_RANGE_MAX_DAYS,
  type ScheduleDay,
  type ScheduleEntry,
} from "@/lib/caring-contacts/schedule-view";

const TEAM = teamId("TEAM-NORTH");
const COORDINATOR: Actor = { id: actorId("ACTOR-1"), teamId: TEAM, roles: ["coordinator"] };
const DISPATCHER: SystemActor = { id: actorId("SYSTEM-DISPATCHER"), teamId: TEAM, systemRole: "contactDispatcher" };

/** 2026-08-30 10:00 AWST. Chosen so the default first contact lands on the last day of August. */
const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
const NOW = "2026-08-30T03:00:00.000Z";

const MONTH_END = "2026-08-31";
const NEXT_MONTH_START = "2026-09-01";

let seeded = 0;

type SeedOptions = {
  sendingPreference?: SendingPreference;
  dischargeAt?: Date;
  firstContactDate?: string;
  firstContactReason?: string;
  /** Where the plan should end up. `draft` leaves it un-activated. */
  planState?: Extract<PlanState, "draft" | "active" | "paused" | "withdrawn">;
};

function newStore(): CaringContactRepository {
  return createInMemoryRepository(fixedClock(NOW));
}

/** Creates one plan through the real write path and leaves it in the requested state. */
async function seedPlan(store: CaringContactRepository, options: SeedOptions = {}): Promise<PlanId> {
  seeded += 1;
  const suffix = String(seeded).padStart(3, "0");
  const id = planId(`SYN-PLAN-${suffix}`);
  const created = await store.createPlan(
    {
      planId: id,
      referralId: referralId(`SYN-REFERRAL-${suffix}`),
      patientId: patientId(`SYN-PATIENT-${suffix}`),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: options.dischargeAt ?? DISCHARGE_AT,
      sendingPreference: options.sendingPreference ?? "earlyEvening",
      firstContactDate: options.firstContactDate,
      firstContactReason: options.firstContactReason,
      // Required since Task 9b. The derived both-confirmed set rather than a literal, so this
      // fixture cannot drift from the source if an assurance is ever added.
      assurances: PLAN_ASSURANCE_VALUES,
      patientDetail: {
        patientName: `Synthetic Patient ${suffix}`,
        // Required since Task P. An ordinary episode holds one; these cases are not about it.
        preferredName: "Synthetic",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: [`UR-${suffix}`],
        culturalIdentity: null,
      },
    },
    { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-create-${suffix}`) },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);

  const target = options.planState ?? "active";
  if (target === "draft") return id;

  const activated = await store.activatePlan(
    { planId: id, expectedVersion: created.value.plan.version },
    { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-activate-${suffix}`) },
  );
  if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);

  if (target === "paused") {
    const paused = await store.pausePlan(
      { planId: id, expectedVersion: activated.value.plan.version },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-pause-${suffix}`) },
    );
    if (!paused.ok) throw new Error(`seed pausePlan refused: ${paused.reason}`);
  }
  if (target === "withdrawn") {
    const withdrawn = await store.withdrawPlan(
      { planId: id, expectedVersion: activated.value.plan.version, origin: "patient" },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey(`seed-withdraw-${suffix}`) },
    );
    if (!withdrawn.ok) throw new Error(`seed withdrawPlan refused: ${withdrawn.reason}`);
  }
  return id;
}

async function plansOf(store: CaringContactRepository): Promise<PlanRecord[]> {
  return store.listPlans({ actor: COORDINATOR });
}

function planIn(records: readonly PlanRecord[], id: PlanId): PlanRecord {
  const found = records.find((record) => record.plan.id === id);
  if (!found) throw new Error(`no plan ${id} in the read`);
  return found;
}

/** The contact a plan holds for a given AWST calendar day, by the instant it actually sends at. */
function contactOn(record: PlanRecord, calendarDay: string): StoredContact {
  const found = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === calendarDay);
  if (found.length !== 1) throw new Error(`expected one contact on ${calendarDay}, found ${found.length}`);
  return found[0];
}

/** Drives one contact through the dispatch path to the state named. */
async function driveContactTo(
  store: CaringContactRepository,
  id: PlanId,
  stored: StoredContact,
  state: Extract<ContactState, "sent" | "delivered" | "statusUnavailable" | "missed">,
): Promise<void> {
  const key = (step: string) => idempotencyKey(`${stored.contact.id}-${step}`);
  if (state === "missed") {
    const missed = await store.recordContactMissed(
      { planId: id, contactId: stored.contact.id, expectedContactVersion: stored.contact.version },
      { actor: DISPATCHER, idempotencyKey: key("missed") },
    );
    if (!missed.ok) throw new Error(`recordContactMissed refused: ${missed.reason}`);
    return;
  }

  const started = await store.startContactDispatch(
    { planId: id, contactId: stored.contact.id, expectedContactVersion: stored.contact.version },
    { actor: DISPATCHER, idempotencyKey: key("start") },
  );
  if (!started.ok) throw new Error(`startContactDispatch refused: ${started.reason}`);
  const sent = await store.recordContactSent(
    { planId: id, contactId: stored.contact.id, expectedContactVersion: started.value.contact.version },
    { actor: DISPATCHER, idempotencyKey: key("sent") },
  );
  if (!sent.ok) throw new Error(`recordContactSent refused: ${sent.reason}`);
  if (state === "sent") return;

  const status = await store.recordContactProviderStatus(
    {
      planId: id,
      contactId: stored.contact.id,
      expectedContactVersion: sent.value.contact.version,
      status: state,
    },
    { actor: DISPATCHER, idempotencyKey: key("status") },
  );
  if (!status.ok) throw new Error(`recordContactProviderStatus refused: ${status.reason}`);
}

function dayOf(records: readonly PlanRecord[], calendarDay: string): ScheduleDay {
  const result = buildScheduleRange(records, calendarDay, calendarDay);
  if (!result.ok) throw new Error(`buildScheduleRange refused: ${result.reason}`);
  expect(result.view.days).toHaveLength(1);
  return result.view.days[0];
}

/** Every entry a day holds, however it is grouped. The partition assertion below depends on it. */
function allEntries(day: ScheduleDay): ScheduleEntry[] {
  return [
    ...day.windows.flatMap((window) => window.entries),
    ...day.outsideApprovedWindows.entries,
    ...day.exceptions.entries,
  ];
}

describe("sendingPreferenceAt — which approved window an instant sends in", () => {
  it("answers each approved preference at its own send time", () => {
    for (const option of SENDING_PREFERENCE_OPTIONS) {
      // The hour is recovered from the option's own published send time rather than typed out
      // here, so this case cannot go on asserting an hour the module has moved away from.
      const [hour, meridiem] = option.sendTime.split(":");
      const wallClockHour = (Number(hour) % 12) + (meridiem.includes("pm") ? 12 : 0);
      const instant = new Date(Date.UTC(2026, 7, 31, wallClockHour - 8, 0, 0, 0));
      expect(sendingPreferenceAt(instant)).toBe(option.preference);
    }
  });

  it("answers null for a time inside the approved window that is not an approved send time", () => {
    // Reachable: `moveContactWithinDay` accepts any in-window hour and minute, and both stores
    // persist the result. 11:00 AWST on 2026-08-31.
    expect(sendingPreferenceAt(new Date("2026-08-31T03:00:00.000Z"))).toBeNull();
  });

  it("answers null when the minute is not zero, rather than filing a moved contact under a window it left", () => {
    // 10:30 AWST. There is no domain rule saying a half-past send is still "morning", and
    // inventing a band here would be a second copy of the window mapping.
    expect(sendingPreferenceAt(new Date("2026-08-31T02:30:00.000Z"))).toBeNull();
  });

  it("answers null for an invalid instant rather than throwing inside a read", () => {
    expect(sendingPreferenceAt(new Date("not a date"))).toBeNull();
  });
});

describe("planSendingHold — what the plan's own state says about sending", () => {
  it("holds every state except active, and holds nothing while active", () => {
    const states: PlanState[] = ["draft", "active", "paused", "withdrawn", "cancelled", "completed"];
    expect(states.map((state) => [state, planSendingHold(state)])).toEqual([
      ["draft", "planNotStarted"],
      ["active", null],
      ["paused", "planPaused"],
      ["withdrawn", "planEnded"],
      ["cancelled", "planEnded"],
      ["completed", "planEnded"],
    ]);
  });
});

describe("needsOperationalReview — which contact states name a person's attention", () => {
  it("classifies every contact state, and only the ones a coordinator must act on are named", () => {
    const states: ContactState[] = [
      "scheduled",
      "processing",
      "sent",
      "delivered",
      "notDelivered",
      "numberInvalid",
      "contactChanged",
      "statusUnavailable",
      "missed",
      "suppressed",
      "cancelled",
    ];
    expect(states.filter((state) => needsOperationalReview(state))).toEqual([
      "notDelivered",
      "numberInvalid",
      "contactChanged",
      "statusUnavailable",
      "missed",
    ]);
  });
});

describe("buildScheduleRange — the day a coordinator is looking at", () => {
  it("places a 17:00 AWST contact on the last day of a month on that day, not the next one", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "earlyEvening" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    const entries = allEntries(day);
    expect(entries.map((entry) => entry.calendarDay)).toEqual([MONTH_END]);
    expect(entries[0].planId).toBe(id);
    expect(entries[0].cadenceLabel).toBe("Day 1");

    // And the day after the month ends holds nothing from this plan.
    expect(dayOf(records, NEXT_MONTH_START).disposition).toBe("noContactsPlanned");
  });

  it("groups a contact by the AWST day it sends on, not the UTC date and not the day recorded beside it", () => {
    // DEFENSIVE. 2026-09-01 00:00 AWST is 2026-08-31 16:00 UTC, and the approved window means no
    // planner can produce it -- so this record is assembled by hand, with `planned.calendarDay`
    // deliberately set to the UTC date. Both wrong answers are therefore available to the code
    // under test, and it must choose neither.
    const midnightAwst = new Date("2026-08-31T16:00:00.000Z");
    const record: PlanRecord = {
      plan: { id: planId("SYN-PLAN-MIDNIGHT"), teamId: TEAM, state: "active", version: 2 },
      patientId: patientId("SYN-PATIENT-MIDNIGHT"),
      referralId: referralId("SYN-REFERRAL-MIDNIGHT"),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      // Required since Task 9b. Empty rather than populated: this record is assembled by hand
      // rather than seeded, and it is not about the attestations.
      assuranceAttestations: [],
      dischargeAt: DISCHARGE_AT,
      // Not under test here: this fixture asserts nothing about the unclaimed queue age, so the
      // plan's creation instant is set to the same instant as its discharge rather than invented.
      createdAt: DISCHARGE_AT,
      completedAt: null,
      outcome: "inProgress",
      contacts: [
        {
          contact: {
            id: contactId("SYN-CONTACT-MIDNIGHT"),
            planId: planId("SYN-PLAN-MIDNIGHT"),
            state: "scheduled",
            version: 1,
          },
          planned: {
            sequence: 1,
            cadenceLabel: "Day 1",
            calendarDay: MONTH_END,
            sendAt: midnightAwst,
            messageType: "first",
          },
        },
      ],
    };

    expect(dayOf([record], MONTH_END).disposition).toBe("noContactsPlanned");
    const next = dayOf([record], NEXT_MONTH_START);
    expect(allEntries(next).map((entry) => entry.calendarDay)).toEqual([NEXT_MONTH_START]);
  });

  it("enumerates every day of a range that crosses a month end, including the ones holding nothing", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "earlyEvening" });
    const records = await plansOf(store);

    const result = buildScheduleRange(records, MONTH_END, "2026-09-06");
    if (!result.ok) throw new Error(`buildScheduleRange refused: ${result.reason}`);
    expect(result.view.days.map((day) => day.calendarDay)).toEqual([
      MONTH_END,
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
    // Week 1 is discharge + 7 = 2026-09-06, the far end of the strip.
    expect(result.view.days.at(-1)?.disposition).toBe("contactsDue");
  });

  it("refuses an inverted, malformed or over-long range by name rather than answering something", async () => {
    const store = newStore();
    const records = await plansOf(store);
    expect(buildScheduleRange(records, "2026-09-02", "2026-09-01")).toEqual({
      ok: false,
      reason: "schedule-range-inverted",
    });
    expect(buildScheduleRange(records, "2026-02-30", "2026-03-01")).toEqual({
      ok: false,
      reason: "schedule-range-invalid-day",
    });
    const from = "2026-01-01";
    const tooLong = buildScheduleRange(records, from, "2026-12-31");
    expect(tooLong).toEqual({ ok: false, reason: "schedule-range-too-long" });
    // The longest range it DOES accept is the published maximum, counted rather than typed out.
    const longest = buildScheduleRange(records, from, "2026-01-31");
    if (!longest.ok) throw new Error(`buildScheduleRange refused the published maximum: ${longest.reason}`);
    expect(longest.view.days).toHaveLength(SCHEDULE_RANGE_MAX_DAYS);
  });
});

describe("buildScheduleRange — the three sending windows", () => {
  it("always publishes the three approved windows in the order they occur in a day", async () => {
    const store = newStore();
    const records = await plansOf(store);
    const day = dayOf(records, MONTH_END);
    expect(day.windows.map((window) => window.preference)).toEqual(
      SENDING_PREFERENCE_OPTIONS.map((option) => option.preference),
    );
    expect(day.windows.map((window) => window.sendTime)).toEqual(
      SENDING_PREFERENCE_OPTIONS.map((option) => option.sendTime),
    );
  });

  it("files each plan's contact under the window its own sending preference sends in", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning" });
    await seedPlan(store, { sendingPreference: "afternoon" });
    await seedPlan(store, { sendingPreference: "earlyEvening" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    expect(day.windows.map((window) => [window.preference, window.entries.length])).toEqual([
      ["morning", 1],
      ["afternoon", 1],
      ["earlyEvening", 1],
    ]);
    expect(day.counts.due).toBe(day.windows.length);
  });

  it("puts a contact moved off an approved send time in its own group rather than a window it left", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    const moved = contactOn(planIn(records, id), MONTH_END);
    const rescheduled = await store.rescheduleContact(
      {
        planId: id,
        contactId: moved.contact.id,
        expectedContactVersion: moved.contact.version,
        change: { contact: moved.planned, toHour: 11, toMinute: 30 },
      },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("move-1") },
    );
    if (!rescheduled.ok) throw new Error(`rescheduleContact refused: ${rescheduled.reason}`);

    const day = dayOf(await plansOf(store), MONTH_END);
    expect(day.windows.flatMap((window) => window.entries)).toEqual([]);
    expect(day.outsideApprovedWindows.entries.map((entry) => entry.contactId)).toEqual([moved.contact.id]);
    expect(day.outsideApprovedWindows.counts.due).toBe(1);
    expect(day.disposition).toBe("contactsDue");

    // Task 14: the entry carries the STORED contact's own version, and it advanced with the write
    // above. A screen offering a move sends this as `expectedContactVersion`, so an entry that
    // published a constant -- or the version as it was before the move -- would make every later
    // move on this contact a stale-version refusal, or worse, silently overwrite somebody else's.
    // The pair is the point: the first line would pass against a constant 2, the second would not.
    expect(day.outsideApprovedWindows.entries[0].contactVersion).toBe(moved.contact.version + 1);
    expect(day.outsideApprovedWindows.entries[0].contactVersion).toBe(rescheduled.value.contact.version);
  });

  it("puts every entry the day holds in exactly one group", async () => {
    const store = newStore();
    const active = await seedPlan(store, { sendingPreference: "morning" });
    await seedPlan(store, { sendingPreference: "afternoon", planState: "draft" });
    const records = await plansOf(store);
    const failing = contactOn(planIn(records, active), MONTH_END);
    await driveContactTo(store, active, failing, "statusUnavailable");

    const day = dayOf(await plansOf(store), MONTH_END);
    const entries = allEntries(day);
    expect(new Set(entries.map((entry) => entry.contactId)).size).toBe(entries.length);
    expect(entries).toHaveLength(day.counts.total);
  });
});

describe("buildScheduleRange — what is not due, and why", () => {
  it("keeps an absorbed first contact as its own reason rather than as a cancellation", async () => {
    const store = newStore();
    // Discharge + 7 puts the first contact on the Week 1 day, which absorbs the Week 1 entry.
    const id = await seedPlan(store, {
      firstContactDate: "2026-09-06",
      firstContactReason: "The ward agreed the first message would follow the family meeting.",
      sendingPreference: "morning",
    });
    const records = await plansOf(store);
    const record = planIn(records, id);

    // Derived from the plan itself: one planned entry is absorbed, so one fewer contact sends than
    // the planner produced. Nothing here states either number.
    const absorbed = record.contacts.filter((stored) => stored.planned.suppressed !== undefined);
    expect(absorbed).toHaveLength(1);

    // What the plan itself holds for that day, derived rather than stated: the moved first contact
    // and the entry it absorbed, which share the day and must not share a fate.
    const onThatDay = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === "2026-09-06");
    expect(onThatDay.length).toBeGreaterThan(absorbed.length);

    const day = dayOf(records, "2026-09-06");
    const entries = allEntries(day);
    expect(entries).toHaveLength(onThatDay.length);
    expect(entries.filter((entry) => entry.notSendingReason === "absorbedByFirstContact")).toHaveLength(
      absorbed.length,
    );
    expect(entries.filter((entry) => entry.isDue)).toHaveLength(onThatDay.length - absorbed.length);
    expect(day.counts.willNotBeSent).toBe(absorbed.length);
    expect(day.disposition).toBe("contactsDue");
  });

  it("distinguishes a day whose every contact is stopped from a day that was never given one", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning", planState: "withdrawn" });
    const records = await plansOf(store);

    const stopped = dayOf(records, MONTH_END);
    expect(stopped.disposition).toBe("nothingDue");
    expect(stopped.counts.total).toBeGreaterThan(0);
    expect(stopped.counts.willNotBeSent).toBe(stopped.counts.total);
    expect(allEntries(stopped).map((entry) => entry.notSendingReason)).toEqual(["cancelled"]);

    const never = dayOf(records, NEXT_MONTH_START);
    expect(never.disposition).toBe("noContactsPlanned");
    expect(never.counts.total).toBe(0);
  });

  it("names a missed contact as missed and not as a cancellation", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    await driveContactTo(store, id, contactOn(planIn(records, id), MONTH_END), "missed");

    const day = dayOf(await plansOf(store), MONTH_END);
    const entries = allEntries(day);
    expect(entries.map((entry) => entry.notSendingReason)).toEqual(["missed"]);
    expect(day.counts.due).toBe(0);
    expect(day.disposition).toBe("nothingDue");
  });
});

describe("buildScheduleRange — the plan's own state holds sending", () => {
  it("does not call a draft plan's contact due, and says the plan has not started", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning", planState: "draft" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    const entries = allEntries(day);
    expect(entries.map((entry) => [entry.sendability, entry.planHold, entry.isDue])).toEqual([
      ["stillToSend", "planNotStarted", false],
    ]);
    expect(day.counts.due).toBe(0);
    expect(day.counts.held).toBe(1);
    expect(day.disposition).toBe("nothingDue");
  });

  it("does not call a paused plan's contact due, and says the plan is paused", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning", planState: "paused" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    expect(allEntries(day).map((entry) => entry.planHold)).toEqual(["planPaused"]);
    expect(day.counts.due).toBe(0);
    expect(day.counts.held).toBe(1);
  });

  it("splits still-to-send between due and held, and never loses one", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning" });
    await seedPlan(store, { sendingPreference: "afternoon", planState: "paused" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    expect(day.counts.due + day.counts.held).toBe(day.counts.stillToSend);
    expect(day.counts.stillToSend).toBe(2);
  });
});

describe("buildScheduleRange — what an entry carries through from the planner and the plan", () => {
  it("carries each contact's own message kind, so the closing message stays a distinct kind", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    const record = planIn(records, id);

    // Each contact is looked up on the AWST day it actually sends on: a plan runs for months and
    // no single accepted range spans one, so there is no whole-plan call to make here.
    const carried = record.contacts.map((stored) => {
      const day = dayOf(records, awstCalendarDay(stored.planned.sendAt));
      const entry = allEntries(day).find((candidate) => candidate.contactId === stored.contact.id);
      if (!entry) throw new Error(`no entry for ${stored.contact.id} on the day it sends`);
      return [entry.contactId, entry.messageType];
    });

    // Derived from the planner rather than typed out: whatever kind it stamped on each contact is
    // the kind the read reports for that contact.
    expect(carried).toEqual(record.contacts.map((stored) => [stored.contact.id, stored.planned.messageType]));

    // FIXTURE PRECONDITION, not a claim about the code: the plan holds more than one kind, which
    // is what stops the line above from being satisfiable by a constant.
    expect(new Set(record.contacts.map((stored) => stored.planned.messageType)).size).toBeGreaterThan(1);

    // The plan's last contact is the closing message, and the read says so. Named separately
    // because this is the distinction that matters -- a closing message is not one more caring
    // contact, and a screen that could not tell them apart would say the wrong thing about a plan
    // ending.
    expect(carried.at(-1)).toEqual([record.contacts.at(-1)?.contact.id, "closing"]);
  });

  it("carries each entry's own plan state, so a held entry says which plan state held it", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning" });
    await seedPlan(store, { sendingPreference: "afternoon", planState: "paused" });
    const records = await plansOf(store);

    const day = dayOf(records, MONTH_END);
    const reported = new Map(allEntries(day).map((entry) => [entry.planId, entry.planState]));
    // Compared plan by plan against each record's own state, so neither list's order is asserted.
    expect(records.map((record) => [record.plan.id, reported.get(record.plan.id)])).toEqual(
      records.map((record) => [record.plan.id, record.plan.state]),
    );

    // FIXTURE PRECONDITION, not a claim about the code: the plans under test hold more than one
    // state between them, which is what stops the line above from being satisfiable by a constant.
    // Read from the plan RECORDS and never from the read's output, so a failure here can only mean
    // the fixture stopped seeding two states -- never that the code hardcoded one.
    expect(new Set(records.map((record) => record.plan.state)).size).toBeGreaterThan(1);
  });
});

describe("buildScheduleRange — named exceptions", () => {
  it("keeps a contact needing operational review out of the routine window lists", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    const stored = contactOn(planIn(records, id), MONTH_END);
    await driveContactTo(store, id, stored, "statusUnavailable");

    const day = dayOf(await plansOf(store), MONTH_END);
    expect(day.windows.flatMap((window) => window.entries)).toEqual([]);
    expect(day.exceptions.entries.map((entry) => [entry.contactId, entry.state])).toEqual([
      [stored.contact.id, "statusUnavailable"],
    ]);
    expect(day.counts.needsReview).toBe(1);
  });

  it("leaves a delivered contact in its window and names no exception", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    await driveContactTo(store, id, contactOn(planIn(records, id), MONTH_END), "delivered");

    const day = dayOf(await plansOf(store), MONTH_END);
    expect(day.exceptions.entries).toEqual([]);
    expect(day.counts.needsReview).toBe(0);
    expect(day.counts.alreadySent).toBe(1);
    const routine = day.windows.flatMap((window) => window.entries);
    expect(routine.map((entry) => entry.sendability)).toEqual(["alreadySent"]);
    // A contact that went out is not "not sending", so it carries no reason for not sending.
    expect(routine.map((entry) => entry.notSendingReason)).toEqual([null]);
    // Already sent is not still to send, so the day is not "due" -- and it is not empty either.
    expect(day.disposition).toBe("nothingDue");
  });
});

describe("buildScheduleRange — what it releases", () => {
  it("carries no patient-identifying field", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);
    const serialised = JSON.stringify(dayOf(records, MONTH_END));
    expect(serialised).not.toContain("Synthetic Patient");
    expect(serialised).not.toContain("491 570 156");
    expect(serialised).not.toContain("UR-");
  });

  it("orders a window's entries the same way whatever order the plans arrive in", async () => {
    const store = newStore();
    // Two plans sharing one window on one day send at the SAME instant, so the send time cannot
    // order them and the tie-break is what a screen actually depends on. Reversing the input is
    // what makes an implementation that merely preserved arrival order visible here.
    const first = await seedPlan(store, { sendingPreference: "morning" });
    const second = await seedPlan(store, { sendingPreference: "morning" });
    const records = await plansOf(store);

    const forwards = dayOf(records, MONTH_END);
    const backwards = dayOf([...records].reverse(), MONTH_END);
    const morningOf = (day: ScheduleDay) => {
      const window = day.windows.find((candidate) => candidate.preference === "morning");
      if (!window) throw new Error("no morning window in the day");
      return window.entries.map((entry) => entry.planId);
    };
    expect(morningOf(forwards)).toEqual([first, second]);
    expect(morningOf(backwards)).toEqual([first, second]);
  });
});
