// tests/caring-contacts-schedule-screen.dom.test.tsx
//
// Phase 2B Task 13 -- the Schedule screen, rendered against real `buildScheduleRange` output.
//
// WHY THE FIXTURES ARE PLANS AND NOT VIEWS. Everything this screen says comes off a
// `ScheduleRangeView`, so a test that hand-built one would prove the component renders whatever it
// is handed and nothing about what a real day looks like. The plans below go through
// `createInMemoryRepository` and the real lifecycle writes, then through the real derivation, so a
// day that reads "nothing is due" here is a day the store could actually hold. The one exception is
// the AWST midnight case, unreachable through the planner (the approved window starts at 09:00) and
// therefore assembled by hand and labelled as defensive, exactly as Task 12's suite does.
//
// WHAT THIS FILE IS FOR. Four pairs of days that a careless schedule renders identically, and each
// of the four is two different clinical facts:
//
//   1. a day whose every contact was stopped, against a day with no contact on it at all;
//   2. a plan somebody created and never started, against a day that is genuinely quiet;
//   3. the three different days `disposition: "nothingDue"` covers -- everything already sent,
//      everything held by its own plan, and everything stopped;
//   4. an empty day you chose, against an empty stretch of days.
//
// Each assertion below holds at least one side to EXPECTED CONTENT rather than only to "these two
// differ": three empty lists agree perfectly, and a pair of renders compared only against each
// other stays green when the thing they share is emptied.
import { render, screen, within } from "@testing-library/react";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

/**
 * The router, because a contact row now carries a control that asks for a re-render.
 *
 * `ContactTimeAdjustment` calls `useRouter()` so a confirmed move updates the row's own send time,
 * which `ContactRow` renders from the server. `useRouter` throws outside an app-router context, so
 * this file needs the mock even though nothing here confirms a move -- the hook runs at render.
 */
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh: () => {} }),
}));

import { WorkspaceOverlays } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import {
  parseScheduleDay,
  scheduleDayWasNotUnderstood,
  ScheduleScreen,
  scheduleDayLabel,
  SCHEDULE_STRIP_DAYS,
  SCHEDULE_STRIP_DAYS_BEFORE,
} from "@/components/caring-contacts/workspace/schedule-screen";
import { awstCalendarDay, awstCalendarDayOffset, fixedClock } from "@/lib/caring-contacts/clock";
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
import type { SendingPreference } from "@/lib/caring-contacts/model";
import type { Actor, SystemActor } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository, PlanRecord, StoredContact } from "@/lib/caring-contacts/repository";
import { SENDING_PREFERENCE_OPTIONS } from "@/lib/caring-contacts/schedule";
import {
  buildScheduleRange,
  type ScheduleDay,
  type ScheduleEntry,
  type ScheduleRangeView,
} from "@/lib/caring-contacts/schedule-view";

const TEAM = teamId("TEAM-NORTH");
const COORDINATOR: Actor = { id: actorId("ACTOR-1"), teamId: TEAM, roles: ["coordinator"] };
const DISPATCHER: SystemActor = { id: actorId("SYSTEM-DISPATCHER"), teamId: TEAM, systemRole: "contactDispatcher" };

/** 2026-08-30 10:00 AWST, so the default first contact lands on the last day of August. */
const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
const NOW = "2026-08-30T03:00:00.000Z";

/** The day under test throughout: a month end, and the day the default first contact falls on. */
const MONTH_END = "2026-08-31";
const NEXT_MONTH_START = "2026-09-01";

/** A day far enough from any seeded plan that nothing can fall on it. */
const QUIET_DAY = "2026-08-20";

/** Discharge + 7: the day a first contact moved onto absorbs the Week 1 message. */
const ABSORBING_FIRST_CONTACT_DAY = "2026-09-06";

let seeded = 0;

function newStore(): CaringContactRepository {
  return createInMemoryRepository(fixedClock(NOW));
}

type SeedOptions = {
  sendingPreference?: SendingPreference;
  planState?: "draft" | "active" | "paused" | "withdrawn";
  /** Moves the first contact off the default discharge + 1. Needed to reach an absorbed Week 1. */
  firstContactDate?: string;
  firstContactReason?: string;
};

/** One plan through the real write path, left in the state named. */
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
      dischargeAt: DISCHARGE_AT,
      sendingPreference: options.sendingPreference ?? "morning",
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

/** The contact a plan holds on one AWST calendar day, found by the instant it actually sends at. */
function contactOn(record: PlanRecord, calendarDay: string): StoredContact {
  const found = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === calendarDay);
  if (found.length !== 1) throw new Error(`expected one contact on ${calendarDay}, found ${found.length}`);
  return found[0];
}

/** Drives one contact to `delivered` or `missed` through the real dispatch path. */
async function driveContactTo(
  store: CaringContactRepository,
  id: PlanId,
  stored: StoredContact,
  state: "delivered" | "statusUnavailable" | "notDelivered" | "missed",
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

/**
 * The strip the page would ask for, around one day.
 *
 * The same arithmetic `src/app/caring-contacts/schedule/page.tsx` performs, kept here as a fixture
 * rather than asserted: what is under test below is what the screen SAYS about the days, not which
 * days the page picks -- `tests/caring-contacts-schedule-page.dom.test.tsx` pins that.
 */
function viewAround(records: readonly PlanRecord[], selectedCalendarDay: string): ScheduleRangeView {
  const from = awstCalendarDayOffset(selectedCalendarDay, -SCHEDULE_STRIP_DAYS_BEFORE);
  const to = awstCalendarDayOffset(from, SCHEDULE_STRIP_DAYS - 1);
  const result = buildScheduleRange(records, from, to);
  if (!result.ok) throw new Error(`buildScheduleRange refused: ${result.reason}`);
  return result.view;
}

/** Every entry a day holds, in whichever group it landed in. Undefined day means the strip is wrong. */
function allEntriesOf(day: ScheduleDay | undefined): ScheduleEntry[] {
  if (!day) throw new Error("the day under test is not in the strip that was built for it");
  return [
    ...day.windows.flatMap((window) => window.entries),
    ...day.outsideApprovedWindows.entries,
    ...day.exceptions.entries,
  ];
}

function renderScreen(
  records: readonly PlanRecord[],
  selectedCalendarDay: string,
  options: { mayViewPlans?: boolean; todayCalendarDay?: string; mayMoveContactWithinDay?: boolean } = {},
) {
  return render(
    <ScheduleScreen
      view={viewAround(records, selectedCalendarDay)}
      selectedCalendarDay={selectedCalendarDay}
      todayCalendarDay={options.todayCalendarDay ?? MONTH_END}
      mayViewPlans={options.mayViewPlans ?? true}
      acting={{
        actorId: COORDINATOR.id,
        teamId: TEAM,
        mayMoveContactWithinDay: options.mayMoveContactWithinDay ?? true,
      }}
    />,
  );
}

/**
 * The screen's statement about the day it is open on.
 *
 * Found by its own test id, not by walking from the counts readout. `previousElementSibling` read
 * the right node only for as long as nothing was inserted between the two, and an element added
 * later would have made this read the WRONG node rather than fail -- a test that quietly changes
 * what it asserts is worse than one that breaks.
 */
function dayStatementText(): string {
  const statement = document.querySelector("[data-testid='caring-contacts-schedule-day-statement']");
  if (!statement) throw new Error("the day statement is missing");
  return statement.textContent ?? "";
}

function dayStrip() {
  return screen.getByRole("navigation", { name: "Choose a day" });
}

describe("the Schedule screen — the day strip", () => {
  it("offers every day of the strip as a link, with exactly one marked as the day being looked at", async () => {
    const store = newStore();
    await seedPlan(store);

    renderScreen(await plansOf(store), MONTH_END);

    const days = within(dayStrip()).getAllByRole("link");
    expect(days).toHaveLength(SCHEDULE_STRIP_DAYS);
    expect(days.map((day) => day.getAttribute("data-schedule-day"))).toEqual([
      "2026-08-28",
      "2026-08-29",
      "2026-08-30",
      MONTH_END,
      NEXT_MONTH_START,
      "2026-09-02",
      "2026-09-03",
    ]);
    expect(days.filter((day) => day.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(days.find((day) => day.getAttribute("aria-current") === "page")?.getAttribute("data-schedule-day")).toBe(
      MONTH_END,
    );
  });

  it("counts what a day HOLDS, not only what is due on it, so a day of exceptions is not a zero", async () => {
    const store = newStore();
    const id = await seedPlan(store);
    const records = await plansOf(store);
    await driveContactTo(store, id, contactOn(planIn(records, id), MONTH_END), "missed");

    const after = await plansOf(store);
    renderScreen(after, MONTH_END);

    // The premise, read off the derivation rather than assumed: this day holds a contact and none
    // of it is due. Without this the assertion below could pass on a day that simply had one due.
    const day = viewAround(after, MONTH_END).days.find((entry) => entry.calendarDay === MONTH_END);
    expect(day?.counts.total).toBe(1);
    expect(day?.counts.due).toBe(0);

    const selected = within(dayStrip())
      .getAllByRole("link")
      .find((link) => link.getAttribute("data-schedule-day") === MONTH_END);
    // `getByText` matches an element whose whole normalised text is "1", so the "31" inside
    // "Mon 31 Aug" cannot satisfy it -- which `toContain("1")` did, silently, before this.
    expect(within(selected as HTMLElement).getByText("1")).toBeTruthy();

    const accessibleName = selected?.querySelector(".sr-only")?.textContent ?? "";
    expect(accessibleName).toBe("Mon 31 Aug 2026, Today. 1 contact.");
    // That string is not merely present in the control, it IS the control's name: the faces are
    // `aria-hidden`, so name computation excludes them and this lookup can only match through the
    // `sr-only` span.
    expect(within(dayStrip()).getByRole("link", { name: accessibleName })).toBe(selected);
  });

  it("keeps every visible word of a day inside its accessible name, so voice can address it", async () => {
    const store = newStore();
    await seedPlan(store);

    renderScreen(await plansOf(store), MONTH_END);

    // WCAG 2.5.3 Label in Name, level A. Checked on every day of the strip rather than on one,
    // because the "Today" face appears on exactly one of them and a check on the wrong day would
    // never see it.
    const days = within(dayStrip()).getAllByRole("link");
    const seen: string[][] = [];
    for (const day of days) {
      const visible = [...day.querySelectorAll('[aria-hidden="true"]')].map((face) => face.textContent?.trim() ?? "");
      const accessibleName = day.querySelector(".sr-only")?.textContent ?? "";
      expect(accessibleName, `${day.getAttribute("data-schedule-day")} has no accessible name`).not.toBe("");
      for (const face of visible) {
        expect(
          accessibleName,
          `"${face}" is visible on ${day.getAttribute("data-schedule-day")} but not in its name`,
        ).toContain(face);
      }
      seen.push(visible);
    }
    // The premise, so the loop above cannot pass by inspecting nothing: one day carries the "Today"
    // face and the others do not.
    expect(seen.filter((visible) => visible.includes("Today"))).toHaveLength(1);
    expect(seen.every((visible) => visible.length >= 2)).toBe(true);
  });
});

describe("the Schedule screen — what the day holds, as numbers", () => {
  it("labels every number in the readout with the thing it counts", async () => {
    const store = newStore();
    // Every plan's first contact falls on the month end, so one day carries all of these. The
    // SHAPE of this fixture is the point: no two of the six numbers below are equal, so a value
    // rendered against the wrong label cannot be hidden by a coincidence -- which is what a
    // fixture of ones and zeroes would have done.
    for (let due = 0; due < 5; due += 1) await seedPlan(store);
    for (let held = 0; held < 3; held += 1) await seedPlan(store, { planState: "draft" });
    for (let sent = 0; sent < 3; sent += 1) {
      const id = await seedPlan(store);
      await driveContactTo(store, id, contactOn(planIn(await plansOf(store), id), MONTH_END), "delivered");
    }
    const unavailable = await seedPlan(store);
    await driveContactTo(
      store,
      unavailable,
      contactOn(planIn(await plansOf(store), unavailable), MONTH_END),
      "statusUnavailable",
    );
    const missed = await seedPlan(store);
    await driveContactTo(store, missed, contactOn(planIn(await plansOf(store), missed), MONTH_END), "missed");

    renderScreen(await plansOf(store), MONTH_END);

    const readout = screen.getByTestId("caring-contacts-schedule-day-counts");
    const rows = [...readout.querySelectorAll("div")].map((row) => [
      row.querySelector("dt")?.textContent ?? "",
      row.querySelector("dd")?.textContent ?? "",
    ]);
    // Written out rather than derived from the same view the screen was handed: a readout compared
    // against its own input agrees with itself however it is mislabelled.
    expect(rows).toEqual([
      ["On this day", "13"],
      ["Due to send", "5"],
      ["Held by their plan", "3"],
      ["Already sent", "4"],
      ["Will not be sent", "1"],
      ["Named exceptions", "2"],
    ]);

    // The first four rows are the claim this readout makes about the day, so it is asserted from
    // the rendered numbers rather than from the type's doc comment: they partition the total.
    const value = (label: string) => Number(rows.find(([name]) => name === label)?.[1]);
    expect(value("Due to send") + value("Held by their plan") + value("Already sent") + value("Will not be sent")).toBe(
      value("On this day"),
    );
    // And named exceptions cut ACROSS that partition rather than being a fifth part of it: the
    // transport receipt that never arrived is already counted in "Already sent", and the missed
    // message in "Will not be sent".
    expect(
      within(screen.getByRole("region", { name: "Named exceptions" })).getAllByRole("heading", { level: 5 }),
    ).toHaveLength(value("Named exceptions"));
  });
});

describe("the Schedule screen — Ruling [126], a contact at no approved send time", () => {
  it("names the group by the TIME the contact sends at, never as an act somebody performed", async () => {
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

    const after = await plansOf(store);
    const { container } = renderScreen(after, MONTH_END);

    const group = screen.getByRole("region", { name: "Not at an approved send time" });
    // The contact is HERE, and its own send time is stated. 11:30 is inside the approved 09:00 to
    // 18:00 window and is not one of the three send times, which is the whole of what this group is.
    expect(within(group).getByRole("heading", { level: 5 }).textContent).toBe(planIn(after, id).patientId);
    expect(group.textContent).toContain("11:30 am AWST");

    // And it is in NO window. The three windows still render -- their absence would satisfy a
    // "not in a window" check for the wrong reason -- and each says it holds nothing.
    for (const option of SENDING_PREFERENCE_OPTIONS) {
      const window = screen.getByRole("region", { name: option.label });
      expect(window.textContent).toContain("Nothing sends in this window on this day.");
      expect(within(window).queryAllByRole("heading", { level: 5 })).toEqual([]);
    }

    // Ruling [126], corrected: a deliberate move is the only way to reach an off-window time, but
    // the converse is false -- a contact moved onto an approved hour lands silently inside a named
    // window and nothing records that it moved. So the screen may not say "moved" anywhere.
    expect(container.textContent ?? "").not.toMatch(/\bmoved\b/i);
  });
});

describe("the Schedule screen — the four pairs that must not collapse", () => {
  it("pair 1: a day whose every contact was stopped reads differently from a day with none", async () => {
    const store = newStore();
    await seedPlan(store, { planState: "withdrawn" });
    const records = await plansOf(store);

    // The premise, from the derivation: every contact on this day will not be sent.
    const stoppedDay = viewAround(records, MONTH_END).days.find((day) => day.calendarDay === MONTH_END);
    expect(stoppedDay?.counts.total).toBeGreaterThan(0);
    expect(stoppedDay?.counts.willNotBeSent).toBe(stoppedDay?.counts.total);

    const stopped = renderScreen(records, MONTH_END);
    const stoppedStatement = dayStatementText();
    expect(stoppedStatement).toContain("No contact on this day will be sent at all.");
    // A stopped day still shows its contacts and their reason, which is what makes it not an
    // empty day. `Cancelled` is a plan term, stated with why and what would change it.
    expect(screen.getByRole("group", { name: "Cancelled" }).textContent).toContain("never sent later");
    expect(screen.queryByRole("group", { name: "No contacts in these days" })).toBeNull();
    // And NO plan-hold notice. A withdrawn plan does hold its contacts by state -- `planHold` is
    // `planEnded` on every one of them -- but none of them would have gone out anyway, so saying
    // "this plan is stopping a message" would name the wrong reason for the same silence.
    expect(screen.queryByRole("group", { name: "Plan ended" })).toBeNull();
    stopped.unmount();

    // The other half of the pair: a day in the SAME strip that nothing was ever scheduled on.
    // The discharge day itself -- the plan's first contact is the day after it.
    renderScreen(records, "2026-08-30");
    const empty = screen.getByRole("group", { name: "Nothing is scheduled on this day" });
    expect(empty.textContent).toContain("no caring contact on it");
    expect(screen.queryByTestId("caring-contacts-schedule-day-counts")).toBeNull();
    expect(document.body.textContent ?? "").not.toContain("No contact on this day will be sent at all.");
  });

  it("pair 2: a plan created and never started is stated on the day, with why and what would change it", async () => {
    const store = newStore();
    await seedPlan(store, { planState: "draft" });
    const records = await plansOf(store);

    // The premise: this day's contacts are held rather than due, and the disposition alone would
    // report it as a day with nothing on it.
    const day = viewAround(records, MONTH_END).days.find((entry) => entry.calendarDay === MONTH_END);
    expect(day?.disposition).toBe("nothingDue");
    expect(day?.counts.held).toBe(day?.counts.total);

    const held = renderScreen(records, MONTH_END);
    const notice = screen.getByRole("group", { name: "Plan not started" });
    expect(notice.textContent).toContain("created and never started");
    expect(notice.textContent).toContain("receiving nothing while the plan record looks complete");
    expect(notice.textContent).toContain("Starting the plan");
    // Task 12's judgement, rendered rather than re-decided: a held contact is NOT an exception.
    expect(screen.getByRole("region", { name: "Named exceptions" }).textContent).toContain(
      "Nothing on this day needs a decision.",
    );
    held.unmount();

    // The other half: the same day, with the plan started. The notice must be gone, and the day
    // must read as work rather than as a hold.
    const store2 = newStore();
    await seedPlan(store2, { planState: "active" });
    renderScreen(await plansOf(store2), MONTH_END);
    expect(screen.queryByRole("group", { name: "Plan not started" })).toBeNull();
    expect(dayStatementText()).toContain("Contacts still to go out on this day are grouped below");
  });

  it('pair 3: the three days "nothingDue" covers each say which one they are', async () => {
    const statements: Record<string, string> = {};

    const sentStore = newStore();
    const sentPlan = await seedPlan(sentStore);
    await driveContactTo(
      sentStore,
      sentPlan,
      contactOn(planIn(await plansOf(sentStore), sentPlan), MONTH_END),
      "delivered",
    );
    const sentRecords = await plansOf(sentStore);
    const sent = renderScreen(sentRecords, MONTH_END);
    statements.sent = dayStatementText();
    // A transport receipt, never a patient-state label.
    expect(document.body.textContent ?? "").toContain("Delivered (transport receipt)");
    sent.unmount();

    const heldStore = newStore();
    await seedPlan(heldStore, { planState: "draft" });
    const heldRecords = await plansOf(heldStore);
    const held = renderScreen(heldRecords, MONTH_END);
    statements.held = dayStatementText();
    held.unmount();

    const stoppedStore = newStore();
    await seedPlan(stoppedStore, { planState: "withdrawn" });
    const stoppedRecords = await plansOf(stoppedStore);
    const stopped = renderScreen(stoppedRecords, MONTH_END);
    statements.stopped = dayStatementText();
    stopped.unmount();

    // All three days report the same disposition. That is the premise, and it is read off the
    // derivation rather than assumed -- without it these three statements could differ for a
    // reason that has nothing to do with what this screen is being asked to do.
    for (const records of [sentRecords, heldRecords, stoppedRecords]) {
      const day = viewAround(records, MONTH_END).days.find((entry) => entry.calendarDay === MONTH_END);
      expect(day?.disposition).toBe("nothingDue");
    }

    // Each is held to its own expected content, not merely to being different from the others:
    // three statements compared only against each other stay green when the thing they share is
    // emptied.
    expect(statements.sent).toContain("Every contact on this day has already been sent.");
    expect(statements.held).toContain("Every contact on this day belongs to a plan that is not sending.");
    expect(statements.stopped).toContain("No contact on this day will be sent at all.");
    expect(new Set(Object.values(statements)).size).toBe(3);
  });

  // 2026-09-26. A day whose only contact came back Not delivered used to read "Every contact on this
  // day has already been sent", which a clinician reads as the message having arrived.
  it("does not call a day sent when a contact on it was not delivered", async () => {
    const store = newStore();
    const plan = await seedPlan(store);
    await driveContactTo(store, plan, contactOn(planIn(await plansOf(store), plan), MONTH_END), "notDelivered");
    const view = renderScreen(await plansOf(store), MONTH_END);
    const statement = dayStatementText();
    expect(statement).toContain("Every contact on this day has been attempted; one or more was not delivered.");
    expect(statement).not.toContain("already been sent");
    view.unmount();
  });

  it("pair 4: an empty day you chose reads differently from a stretch of days with nothing in it", async () => {
    const store = newStore();
    await seedPlan(store);
    const records = await plansOf(store);

    // A day with nothing on it, inside a strip that does hold contacts elsewhere. The remedy names
    // a real control -- the strip directly above -- and offers a link that goes to a day with work.
    const chosen = renderScreen(records, "2026-08-30");
    const filtered = screen.getByRole("group", { name: "Nothing is scheduled on this day" });
    expect(filtered.textContent).toContain(scheduleDayLabel("2026-08-30"));
    expect(filtered.textContent).toContain("Other days above do hold contacts.");
    expect(within(filtered).getByRole("link").textContent).toBe(`Open ${scheduleDayLabel(MONTH_END)}`);
    chosen.unmount();

    // A strip with nothing anywhere in it. Sending a clinician back to the strip here would send
    // them hunting through days that are all equally empty, so it says something else and offers
    // no such link.
    renderScreen(records, QUIET_DAY);
    const nothing = screen.getByRole("group", { name: "No contacts in these days" });
    expect(nothing.textContent).toContain("starts a plan whose schedule reaches it");
    expect(within(nothing).queryAllByRole("link")).toEqual([]);
    expect(screen.queryByRole("group", { name: "Nothing is scheduled on this day" })).toBeNull();
  });
});

describe("the Schedule screen — a message the system decided not to send", () => {
  it("states the absorbed Week 1 message as suppressed, and gives the remedy that undoes it", async () => {
    const store = newStore();
    // Discharge + 7. The Week 1 message falls on the same calendar day as the first contact, and
    // two caring contacts must never land on one day, so the planner absorbs one of them. This is
    // the case behind "nine, not ten": the plan sends one fewer caring contact than its cadence
    // names, and the final entry is a closing message rather than one more contact.
    const id = await seedPlan(store, {
      firstContactDate: ABSORBING_FIRST_CONTACT_DAY,
      firstContactReason: "Synthetic: the patient asked for the first message a week after discharge.",
    });
    const records = await plansOf(store);

    // The premise, read off the derivation: this day holds an absorbed entry and something else,
    // so neither assertion below can be satisfied by an empty day.
    const day = viewAround(records, ABSORBING_FIRST_CONTACT_DAY).days.find(
      (entry) => entry.calendarDay === ABSORBING_FIRST_CONTACT_DAY,
    );
    const absorbed = allEntriesOf(day).filter((entry) => entry.notSendingReason === "absorbedByFirstContact");
    expect(absorbed).toHaveLength(1);
    expect(day?.counts.due).toBeGreaterThan(0);
    expect(planIn(records, id).plan.state).toBe("active");

    renderScreen(records, ABSORBING_FIRST_CONTACT_DAY);

    // The state the store actually holds, and the reason and remedy beside it. The remedy is the
    // one thing that distinguishes this from every other message that will not be sent: it is
    // reversible by the coordinator, and the plan is working exactly as designed.
    const suppressed = screen.getByRole("group", { name: "Suppressed" });
    expect(suppressed.textContent).toContain("Week 1 message");
    expect(suppressed.textContent).toContain("two caring contacts must never land on one day");
    expect(suppressed.textContent).toContain("Choosing a different first-contact date");
    // The day is still a working day: absorption is not a stopped day.
    expect(dayStatementText()).toContain("Contacts still to go out on this day are grouped below");
  });

  it("states a suppression it does not hold the cause of WITHOUT borrowing the absorbed one's remedy", () => {
    // DEFENSIVE, and the pair the brief names: a plan with every contact suppressed, against a plan
    // with none. `applyContactTransition`'s `suppress` action can move any live contact to
    // `suppressed` with no `planned.suppressed` marker, but no repository method exposes it yet --
    // so this record is assembled by hand rather than seeded, and labelled as such.
    const record: PlanRecord = {
      plan: { id: planId("SYN-PLAN-SUPPRESSED"), teamId: TEAM, state: "active", version: 2 },
      patientId: patientId("SYN-PATIENT-SUPPRESSED"),
      referralId: referralId("SYN-REFERRAL-SUPPRESSED"),
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
            id: contactId("SYN-CONTACT-SUPPRESSED"),
            planId: planId("SYN-PLAN-SUPPRESSED"),
            state: "suppressed",
            version: 2,
          },
          planned: {
            sequence: 1,
            cadenceLabel: "Day 1",
            calendarDay: MONTH_END,
            // 10:00 AWST on the month end -- an ordinary morning send that never happened.
            sendAt: new Date("2026-08-31T02:00:00.000Z"),
            messageType: "first",
          },
        },
      ],
    };

    // The premise: no planner marker, so the reason has to come from the contact's own state.
    expect(record.contacts[0].planned.suppressed).toBeUndefined();

    renderScreen([record], MONTH_END);

    // Every contact on the day is suppressed, and the day says so rather than reading as empty.
    expect(dayStatementText()).toContain("No contact on this day will be sent at all.");
    expect(screen.queryByRole("group", { name: "Nothing is scheduled on this day" })).toBeNull();

    const suppressed = screen.getByRole("group", { name: "Suppressed" });
    expect(suppressed.textContent).toContain("does not hold what caused that");
    expect(suppressed.textContent).toContain("never sent later");
    // And it does NOT offer the absorbed message's remedy, which would send a coordinator to change
    // a first-contact date that has nothing to do with this.
    expect(suppressed.textContent).not.toContain("Choosing a different first-contact date");
  });
});

describe("the Schedule screen — the named-exceptions panel", () => {
  it("takes a missed contact out of its window and states why it is not sent", async () => {
    const store = newStore();
    const missedPlan = await seedPlan(store, { sendingPreference: "morning" });
    const routinePlan = await seedPlan(store, { sendingPreference: "afternoon" });
    await driveContactTo(store, missedPlan, contactOn(planIn(await plansOf(store), missedPlan), MONTH_END), "missed");
    const records = await plansOf(store);

    renderScreen(records, MONTH_END);

    const missedPatient = planIn(records, missedPlan).patientId;
    const routinePatient = planIn(records, routinePlan).patientId;

    const panel = screen.getByRole("region", { name: "Named exceptions" });
    expect(
      within(panel)
        .getAllByRole("heading", { level: 5 })
        .map((heading) => heading.textContent),
    ).toEqual([missedPatient]);
    expect(screen.getByRole("group", { name: "Missed" }).textContent).toContain("never retried");

    // It is in the panel INSTEAD of its window, not as well: one patient counted twice is the
    // defect this separation exists to prevent. The afternoon contact proves the windows are still
    // being populated, so the morning window's emptiness means something.
    const morning = screen.getByRole("region", { name: "Morning" });
    expect(within(morning).queryAllByRole("heading", { level: 5 })).toEqual([]);
    const afternoon = screen.getByRole("region", { name: "Afternoon" });
    expect(
      within(afternoon)
        .getAllByRole("heading", { level: 5 })
        .map((heading) => heading.textContent),
    ).toEqual([routinePatient]);
  });
});

describe("the Schedule screen — the boundaries of a day", () => {
  it("puts a 5:00 pm contact on the last day of the month, and leaves the next day holding nothing", async () => {
    const store = newStore();
    await seedPlan(store, { sendingPreference: "earlyEvening" });
    const records = await plansOf(store);

    renderScreen(records, MONTH_END);

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe(`${scheduleDayLabel(MONTH_END)} (today)`);
    expect(scheduleDayLabel(MONTH_END)).toBe("Monday 31 August 2026");
    const evening = screen.getByRole("region", { name: "Early evening" });
    expect(within(evening).getAllByRole("heading", { level: 5 })).toHaveLength(1);
    // The window's own published send time, which comes from `SENDING_PREFERENCE_OPTIONS`.
    expect(evening.textContent).toContain("5:00 pm AWST");
    // And the ROW's send time, which is formatted from the contact's own instant. Scoped to the
    // row rather than to the section, because the section already carries the window's send time
    // and a section-wide `toContain` would pass on the header alone -- which it did, silently,
    // before this line: mutation M6 broke the row's clock and only the midnight case noticed.
    expect(within(evening).getByRole("listitem").textContent).toContain("Sends at: 5:00 pm AWST");

    // The day after a month end is a different day and holds nothing, which the strip must show as
    // a day rather than not show at all.
    const next = within(dayStrip())
      .getAllByRole("link")
      .find((link) => link.getAttribute("data-schedule-day") === NEXT_MONTH_START);
    expect(next?.querySelector(".sr-only")?.textContent).toBe("Tue 1 Sep 2026. 0 contacts.");
    expect(scheduleDayLabel(NEXT_MONTH_START)).toBe("Tuesday 1 September 2026");
  });

  it("states a midnight AWST contact as 12:00 am on the AWST day, not on the UTC date", () => {
    // DEFENSIVE. 2026-09-01 00:00 AWST is 2026-08-31 16:00 UTC, and the approved window means no
    // planner can produce it -- so this record is assembled by hand, with `planned.calendarDay`
    // deliberately set to the UTC date. Every wrong answer is therefore available: the UTC date,
    // the recorded day, "0:00", and "12:00 pm". The screen must choose none of them.
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

    const onTheAwstDay = renderScreen([record], NEXT_MONTH_START, { todayCalendarDay: NEXT_MONTH_START });
    const group = screen.getByRole("region", { name: "Not at an approved send time" });
    expect(within(group).getByRole("heading", { level: 5 }).textContent).toBe("SYN-PATIENT-MIDNIGHT");
    expect(group.textContent).toContain("12:00 am AWST");
    onTheAwstDay.unmount();

    // And nothing on the UTC date, which is also the day the record names beside the instant.
    renderScreen([record], MONTH_END, { todayCalendarDay: MONTH_END });
    expect(screen.getByRole("group", { name: "Nothing is scheduled on this day" })).toBeTruthy();
  });
});

describe("the Schedule screen — a role that may not view plans", () => {
  it("says the schedule is not visible rather than showing a schedule with nothing in it", async () => {
    const store = newStore();
    await seedPlan(store);

    renderScreen(await plansOf(store), MONTH_END, { mayViewPlans: false });

    const refused = screen.getByRole("group", { name: "The schedule is not visible in this role" });
    expect(refused.textContent).toContain("says nothing about how many contacts fall on any day");
    // No day is offered, because no day was read for this role.
    expect(screen.queryByRole("navigation", { name: "Choose a day" })).toBeNull();
    expect(screen.queryByTestId("caring-contacts-schedule-day-counts")).toBeNull();
  });
});

describe("parseScheduleDay — the day comes from the URL, or from today", () => {
  it("takes a real AWST calendar day from the URL", () => {
    expect(parseScheduleDay({ day: MONTH_END }, QUIET_DAY)).toBe(MONTH_END);
  });

  it("falls back to today for a missing, repeated or impossible day rather than failing the render", () => {
    expect(parseScheduleDay({}, MONTH_END)).toBe(MONTH_END);
    expect(parseScheduleDay({ day: ["2026-08-31", "2026-09-01"] }, MONTH_END)).toBe(MONTH_END);
    // A pattern of digits and dashes would accept both of these; the domain's own check does not.
    expect(parseScheduleDay({ day: "2026-02-30" }, MONTH_END)).toBe(MONTH_END);
    expect(parseScheduleDay({ day: "2026-13-01" }, MONTH_END)).toBe(MONTH_END);
    expect(parseScheduleDay({ day: "yesterday" }, MONTH_END)).toBe(MONTH_END);
  });

  it("reports a day it could not read, and treats a missing day as no misunderstanding", () => {
    expect(scheduleDayWasNotUnderstood({})).toBe(false);
    expect(scheduleDayWasNotUnderstood({ day: MONTH_END })).toBe(false);
    expect(scheduleDayWasNotUnderstood({ day: "2026-02-30" })).toBe(true);
    expect(scheduleDayWasNotUnderstood({ day: "" })).toBe(true);
    expect(scheduleDayWasNotUnderstood({ day: ["2026-08-31", "2026-09-01"] })).toBe(true);
  });
});

/**
 * Phase 2B Task 14 -- what a named exception says about a delivery, and what it refuses to say.
 *
 * The design this panel comes from describes a delivery history the service does not keep: the row
 * `resolve-failed-delivery`'s own frozen summary opens by saying all three attempts are finished,
 * and nothing in this domain counts attempts. So these cases are about ABSENCE as much as presence,
 * and every absence here has a positive control beside it.
 */
describe("the Schedule screen — a delivery the provider did not complete", () => {
  it("states the transport receipt, that nothing is sent again, and offers the overlay", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const stored = contactOn(planIn(await plansOf(store), id), MONTH_END);
    await driveContactTo(store, id, stored, "statusUnavailable");

    const records = await plansOf(store);
    renderScreen(records, MONTH_END);

    const panel = screen.getByRole("region", { name: "Named exceptions" });
    // The premise, first: the row really is in the panel, so nothing below can pass on an empty one.
    expect(within(panel).getByRole("heading", { level: 5 }).textContent).toBe(planIn(records, id).patientId);

    const state = within(panel).getByRole("group", { name: "Transport receipt unavailable" });
    expect(state.textContent).toContain("no transport receipt ever came back");
    // The remedy says what is true of every one of the four provider outcomes.
    expect(state.textContent).toContain("no way to send a caring contact again");

    expect(within(panel).getByRole("button", { name: /Close off this delivery/ })).not.toBeNull();
  });

  it("says an attempt history is not held, and implies no attempt count anywhere on the screen", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const stored = contactOn(planIn(await plansOf(store), id), MONTH_END);
    await driveContactTo(store, id, stored, "statusUnavailable");

    const { container } = renderScreen(await plansOf(store), MONTH_END);

    // THE POSITIVE HALF, so the absence assertions below cannot pass on a screen that renders
    // nothing at all.
    expect(screen.getByTestId("caring-contacts-schedule-attempts-not-recorded").textContent).toContain(
      "a history of sending attempts",
    );

    // And the absence: no sentence this screen renders counts attempts. The overlay's own frozen
    // summary does say "all three attempts", which is why this is scoped to the screen rather than
    // to the document -- that row is the frozen record's wording and not this screen's to edit.
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/all three attempts/i);
    expect(text).not.toMatch(/\b(?:\d+|one|two|three|several) attempts?\b/i);
  });

  it("offers no move control on a contact that has already been sent", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const stored = contactOn(planIn(await plansOf(store), id), MONTH_END);
    await driveContactTo(store, id, stored, "statusUnavailable");
    const records = await plansOf(store);

    // A contact that has already gone out has no time left to change, and a control offering to
    // change it would be advertising an action the system does not perform. The test is the domain's
    // own `contactSendability` answer rather than a list of states written on the screen.
    const sent = renderScreen(records, MONTH_END);
    expect(within(sent.container).queryByTestId("caring-contacts-contact-time-adjustment")).toBeNull();

    // THE POSITIVE CONTROL, and it is the whole reason the absence above means anything: the same
    // plan's Week 1 message is still to send, and the same query finds the control on its day.
    const stillToSend = renderScreen(records, ABSORBING_FIRST_CONTACT_DAY);
    expect(within(stillToSend.container).queryByTestId("caring-contacts-contact-time-adjustment")).not.toBeNull();
  });

  it("carries the correction into the overlay itself, on a decision control that stays focusable", async () => {
    const store = newStore();
    const id = await seedPlan(store, { sendingPreference: "morning" });
    const stored = contactOn(planIn(await plansOf(store), id), MONTH_END);
    await driveContactTo(store, id, stored, "notDelivered");

    renderScreen(await plansOf(store), MONTH_END);
    render(<WorkspaceOverlays />);

    await userEvent.click(screen.getByRole("button", { name: /Close off this delivery/ }));
    const action = screen.getByTestId("workspace-overlay-action");
    // Ruling 87's shape: the decision the system will not honour is refused with the reason visible,
    // and the control keeps its tab stop so a keyboard user reaches that reason.
    expect(action.getAttribute("aria-disabled")).toBe("true");
    expect(action.hasAttribute("disabled")).toBe(false);
    const describedBy = action.getAttribute("aria-describedby");
    expect(document.getElementById(describedBy ?? "")?.textContent ?? "").toContain(
      "does not keep a history of sending attempts",
    );
  });
});
