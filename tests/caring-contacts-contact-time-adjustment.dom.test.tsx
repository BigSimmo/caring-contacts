// tests/caring-contacts-contact-time-adjustment.dom.test.tsx
//
// Phase 2B Task 14 -- moving one caring contact, and the two overlays that stand in the way.
//
// WHAT THIS FILE IS FOR, in one sentence: a guard that refuses must leave the record exactly as it
// found it, and the checks that refuse must run at the moment the coordinator CONFIRMS rather than
// at the moment they open the confirmation.
//
// The second half is the one a naive test cannot tell apart. An interface that checked its
// permission when the overlay opened would pass every "an auditor may not move a contact" test ever
// written, and would still record a write for a coordinator who opened a confirmation, had their
// role switched in another tab, and pressed confirm ten minutes later. So each recheck case below
// opens in a state that PERMITS the move, changes the state while the overlay is open, and only
// then confirms.
//
// THE STORE IS REAL AND THE ROUTE IS MIRRORED, deliberately in that order. The write goes through
// `createInMemoryRepository` and the real `rescheduleContact`, so "the record is unchanged" is a
// claim about a store that could actually have changed -- proved by the success case, which is the
// positive control for every one of those assertions. What is mirrored rather than executed is the
// HTTP boundary: `route.ts` imports `server-only` and `next/headers`, and it has its own suite in
// `tests/caring-contacts-contact-route.test.ts`, which asserts the same refusals against the real
// handler.
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PLAN_ASSURANCE_VALUES } from "@/lib/caring-contacts/assurances";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The router, replaced so `refresh()` is observable.
 *
 * It is the mechanism that makes a confirmed move change what the SCREEN shows rather than only what
 * the control says: `ContactRow` renders the send time from the server, so without a refresh the row
 * and the sentence beneath it disagree. Mocking it also means the props never change during a test,
 * which is exactly the state a coordinator moving the same contact twice in a row is in.
 */
const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

import {
  ContactTimeAdjustment,
  moveRefusalWording,
  parseInputTime,
  SCHEDULE_MOVE_OVERLAYS,
} from "@/components/caring-contacts/workspace/contact-time-adjustment";
import { MUTATING_OVERLAY_IDS } from "@/components/caring-contacts/workspace/overlays/definitions";
import { clearStagedWorkspaceOverlayCommit } from "@/components/caring-contacts/workspace/overlays/overlay-commits";
import { WorkspaceOverlays } from "@/components/caring-contacts/workspace/overlays/workspace-overlays";
import { contactMoveRequestSchema } from "@/lib/caring-contacts-contact-move-request";
import { awstCalendarDay, fixedClock, toAwstParts } from "@/lib/caring-contacts/clock";
import {
  actorId,
  idempotencyKey,
  pathwayVersionId,
  patientId,
  planId,
  referralId,
  teamId,
  type PlanId,
} from "@/lib/caring-contacts/ids";
import { createInMemoryRepository } from "@/lib/caring-contacts/in-memory-repository";
import { canPerformCaringContactAction, type Actor, type CaringContactRole } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository, StoredContact } from "@/lib/caring-contacts/repository";

const TEAM = teamId("TEAM-NORTH");
const ACTOR = actorId("ACTOR-1");
const COORDINATOR: Actor = { id: ACTOR, teamId: TEAM, roles: ["coordinator"] };

/** 2026-08-30 10:00 AWST discharge, so the default first contact lands on the last day of August. */
const DISCHARGE_AT = new Date("2026-08-30T02:00:00.000Z");
const NOW = "2026-08-30T03:00:00.000Z";
const CONTACT_DAY = "2026-08-31";
const PLAN_ID = planId("SYN-PLAN-001");

const CONTACT_ENDPOINT = "/api/caring-contacts/plans";
const SESSION_ENDPOINT = "/api/caring-contacts/session";

/** When true, a successful write answers 200 with a body carrying no contact version. */
let answerWithoutVersion = false;
/** The acting role the mirrored service answers with, changeable mid-test. */
let actingRole: CaringContactRole | null = "coordinator";
/** Every URL the component asked for, in order, so "nothing was even attempted" is checkable. */
let requested: string[] = [];

function newStore(): CaringContactRepository {
  return createInMemoryRepository(fixedClock(NOW));
}

async function seedPlan(store: CaringContactRepository): Promise<PlanId> {
  const created = await store.createPlan(
    {
      planId: PLAN_ID,
      referralId: referralId("SYN-REFERRAL-001"),
      patientId: patientId("SYN-PATIENT-001"),
      pathwayVersionId: pathwayVersionId("SYN-PATHWAY-001"),
      dischargeAt: DISCHARGE_AT,
      sendingPreference: "morning",
      // Required since Task 9b. The derived both-confirmed set rather than a literal, so this
      // fixture cannot drift from the source if an assurance is ever added.
      assurances: PLAN_ASSURANCE_VALUES,
      patientDetail: {
        patientName: "Synthetic Patient 001",
        // Required since Task P. An ordinary episode holds one; this case is not about it.
        preferredName: "Synthetic",
        patientMobileNumber: "+61 491 570 156",
        patientIdentifiers: ["UR-001"],
        culturalIdentity: null,
      },
    },
    { actor: COORDINATOR, idempotencyKey: idempotencyKey("seed-create") },
  );
  if (!created.ok) throw new Error(`seed createPlan refused: ${created.reason}`);
  const activated = await store.activatePlan(
    { planId: PLAN_ID, expectedVersion: created.value.plan.version },
    { actor: COORDINATOR, idempotencyKey: idempotencyKey("seed-activate") },
  );
  if (!activated.ok) throw new Error(`seed activatePlan refused: ${activated.reason}`);
  return PLAN_ID;
}

async function contactUnderTest(store: CaringContactRepository): Promise<StoredContact> {
  const record = await store.getPlan(PLAN_ID, { actor: COORDINATOR });
  if (record === null) throw new Error("the seeded plan is not readable");
  const found = record.contacts.filter((stored) => awstCalendarDay(stored.planned.sendAt) === CONTACT_DAY);
  if (found.length !== 1) throw new Error(`expected one contact on ${CONTACT_DAY}, found ${found.length}`);
  return found[0];
}

/**
 * Everything about the stored contact a move can change, as one comparable value.
 *
 * A whole-record comparison rather than one field: a check that read only `sendAt` would pass a
 * write that advanced the version or replaced the calendar day.
 */
function stateOf(stored: StoredContact): string {
  return JSON.stringify({
    sendAt: stored.planned.sendAt.toISOString(),
    calendarDay: stored.planned.calendarDay,
    version: stored.contact.version,
    state: stored.contact.state,
  });
}

/**
 * The two endpoints, answered the way the real handlers answer them.
 *
 * The capability check and the store call are the two things `writeHandler` and the route do, in
 * that order, with the same sealed-domain function -- so a role that the real boundary refuses is
 * refused here for the same reason and under the same name.
 */
function installService(store: CaringContactRepository) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    requested.push(url);

    if (url === SESSION_ENDPOINT) {
      if (actingRole === null) return new Response("", { status: 500 });
      return Response.json({ role: actingRole });
    }

    if (!url.startsWith(CONTACT_ENDPOINT)) throw new Error(`unexpected request to ${url}`);

    /*
      VALIDATED WITH THE SCHEMA THE ROUTE ITSELF USES, not parsed by hand.

      This mirror used to `JSON.parse` and read four fields off the result, so it never looked at
      `action` at all -- and the real route's union is `.strict()`, which makes a missing or renamed
      field, or any extra one, a 400. A client-side body-shape regression was therefore invisible
      here AND in the route suite, which builds its own request from a fixture rather than from the
      client. That is the same family as the `{ value: null }` divergence caught one round earlier: a
      double that differs from the real thing makes everything downstream of it green and meaningless.
    */
    const parsedBody = contactMoveRequestSchema.safeParse(JSON.parse(String(init?.body ?? "{}")));
    if (!parsedBody.success) return Response.json({ refusal: "invalid-request" }, { status: 400 });
    const body = parsedBody.data;
    // `resolveDemoActor` falls back to the coordinator for anything unreadable rather than
    // throwing -- an unreadable cookie must never lock someone out of a demonstration. Mirrored
    // here, and it MATTERS: it is what makes "the client could not re-read the role" a case where
    // the service would happily have written, so the refusal below has something real to prevent.
    const actor: Actor = { id: ACTOR, teamId: TEAM, roles: [actingRole ?? "coordinator"] };
    const decision = canPerformCaringContactAction(actor, "moveContactWithinDay", { teamId: TEAM });
    if (!decision.allowed) return Response.json({ refusal: decision.reason }, { status: 403 });

    const stored = await contactUnderTest(store);
    const result = await store.rescheduleContact(
      {
        planId: PLAN_ID,
        contactId: stored.contact.id,
        expectedContactVersion: body.expectedContactVersion,
        change: { contact: stored.planned, toHour: body.toHour, toMinute: body.toMinute },
      },
      { actor, idempotencyKey: idempotencyKey(body.idempotencyKey) },
    );
    if (!result.ok) return Response.json({ refusal: result.reason }, { status: 422 });
    // `{ value: <the updated StoredContact> }`, which is what `writeHandler` returns -- NOT
    // `{ value: null }`. The first version of this mirror answered null, and the control then
    // refused every second move because it could not name a version. That was a divergence between
    // the mirror and the real handler, found by a test rather than in production, and it is why
    // `tests/caring-contacts-contact-route.test.ts` now pins this field on the real route.
    return Response.json({ value: answerWithoutVersion ? null : result.value });
  });
}

/** jsdom reports a fixed viewport; the overlay host needs a width to choose a modality at all. */
function setViewportWidth(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.dispatchEvent(new Event("resize"));
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
}

function controlTree(stored: StoredContact) {
  return (
    <>
      <ContactTimeAdjustment
        planId={PLAN_ID}
        contactId={stored.contact.id}
        patientId="SYN-PATIENT-001"
        calendarDay={CONTACT_DAY}
        sendsAt={stored.planned.sendAt}
        contactVersion={stored.contact.version}
        actorId={ACTOR}
        teamId={TEAM}
      />
      <WorkspaceOverlays />
    </>
  );
}

let rerenderControl: (stored: StoredContact) => void = () => {
  throw new Error("no control is rendered");
};

async function renderControl(store: CaringContactRepository) {
  const stored = await contactUnderTest(store);
  const view = render(controlTree(stored));
  rerenderControl = (next: StoredContact) => view.rerender(controlTree(next));
  return stored;
}

function timeField(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[type="time"]');
  if (field === null) throw new Error("the control renders no time field");
  return field;
}

function outcomeText(): string {
  return screen.getByTestId("caring-contacts-contact-move-outcome").textContent ?? "";
}

function openOverlay() {
  return userEvent.click(screen.getByRole("button", { name: /(Move this contact|Check this time)/ }));
}

function overlayAction(): HTMLElement {
  return screen.getByTestId("workspace-overlay-action");
}

function openOverlayId(): string | null {
  return document.querySelector('[data-testid="workspace-overlay-content"]')?.getAttribute("data-overlay-id") ?? null;
}

beforeEach(() => {
  actingRole = "coordinator";
  requested = [];
  navigation.refresh.mockClear();
  answerWithoutVersion = false;
  clearStagedWorkspaceOverlayCommit();
  setViewportWidth(1440);
  setOnline(true);
  window.history.pushState(null, "", "/caring-contacts/schedule");
});

afterEach(() => {
  cleanup();
  clearStagedWorkspaceOverlayCommit();
  vi.unstubAllGlobals();
});

describe("moving one contact within its day", () => {
  it("records the move, and says the change is this demonstration's own", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    expect(openOverlayId()).toBe("adjust-date-time");

    await userEvent.click(overlayAction());

    await waitFor(() => expect(outcomeText()).toContain("11:30 AWST"));
    // The synthetic outcome is announced AS synthetic. A screen in a suicide-prevention prototype
    // that said only "saved" would leave a coordinator to decide for themselves whether a message
    // had moved in the real world.
    expect(outcomeText()).toContain("no message was sent and no number was contacted");

    const after = await contactUnderTest(store);
    expect(toAwstParts(after.planned.sendAt)).toMatchObject({ hour: 11, minute: 30 });
    // THE POSITIVE CONTROL for every "the record is unchanged" assertion in this file: the same
    // comparison, on the same fixture, going the other way.
    expect(stateOf(after)).not.toBe(stateOf(before));
  });

  it("takes a second move from the same screen, and says nothing about anybody else", async () => {
    /*
      THE CASE WHOSE ABSENCE HID A FALSE STATEMENT. `contactVersion` arrives as a prop, so it cannot
      change until a server render lands -- and the router is mocked here, which is precisely the
      state a coordinator who moves the same contact twice without waiting is in. Before the version
      was held in state, the second write carried the version the first had already consumed, the
      store refused it as `stale-version`, and the screen told the coordinator somebody else had
      changed the contact. Nobody had. Every assertion below is about that sentence not appearing.
    */
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).toContain("11:30 AWST"));

    // The second move, with no server render in between.
    fireEvent.change(timeField(), { target: { value: "15:45" } });
    await openOverlay();
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    /*
      THE SENTENCE FIRST, AND THE ORDER IS THE WHOLE POINT.

      These two assertions carry this case's name, and behind the record assertions they could not
      fail in any execution: a refused second move fails the record check first and never reaches
      them, and a successful one satisfies them trivially. An assertion that cannot go red is not a
      test, and this was the case a reader would trust most.
    */
    expect(outcomeText()).not.toContain("This contact changed after this screen read it");
    expect(outcomeText()).toContain("15:45 AWST");

    // Then the record: the second move actually landed, and landed as a second write.
    const after = await contactUnderTest(store);
    expect(toAwstParts(after.planned.sendAt)).toMatchObject({ hour: 15, minute: 45 });
    expect(after.contact.version).toBe(before.contact.version + 2);
  });

  it("refuses the next move rather than guessing a version the service did not confirm", async () => {
    /*
      The conservative branch, and it is reachable: a 200 whose body this screen cannot read a
      version out of. Adding one is the obvious shortcut and it is wrong -- `rescheduleContact`
      increments by exactly one TODAY, so a guess would be right today and silently wrong the first
      time anything else touches the contact between the two writes.
    */
    const store = newStore();
    await seedPlan(store);
    installService(store);
    answerWithoutVersion = true;
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).toContain("11:30 AWST"));

    // The first move landed -- the premise, so what follows is about the SECOND one.
    expect(toAwstParts((await contactUnderTest(store)).planned.sendAt)).toMatchObject({ hour: 11, minute: 30 });
    const afterFirst = await contactUnderTest(store);

    fireEvent.change(timeField(), { target: { value: "15:45" } });
    await openOverlay();
    const beforeSecond = requested.length;
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).not.toContain("11:30 AWST"));

    expect(outcomeText()).toContain("no longer knows which version of this contact");

    // AND "CHECK AGAIN" DOES NOT CLEAR IT. `recheckAtCommit` covers the connection and the role; it
    // cannot read a version, so a button that cleared this refusal would remove the words while the
    // condition still stood. The guard survives, and the statement names what does clear it.
    await userEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(outcomeText()).toContain("checking again cannot tell it"));
    expect(screen.getByRole("button", { name: /Check again/ })).not.toBeNull();
    // Refused, and nothing attempted: the record still holds the first move.
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(afterFirst));
    expect(requested.slice(beforeSecond).filter((url) => url.startsWith(CONTACT_ENDPOINT))).toEqual([]);
    void before;
  });

  it("asks the server to re-render, because the row's send time is the server's", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    // The premise: nothing has asked for a refresh yet, so the assertion below cannot pass on a
    // call some earlier step made.
    expect(navigation.refresh).not.toHaveBeenCalled();

    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).toContain("11:30 AWST"));

    // `ContactRow` renders `Sends at:` from the server render. Announcing a new time while the row
    // above goes on showing the old one is the divergence the matrix's Success clause forbids.
    expect(navigation.refresh).toHaveBeenCalled();
  });

  it("follows the server when a fresh render hands it a different contact", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    // A time typed and NOT confirmed, then somebody else's move landing and the page re-rendering.
    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    const theirs = await store.rescheduleContact(
      {
        planId: PLAN_ID,
        contactId: before.contact.id,
        expectedContactVersion: before.contact.version,
        change: { contact: before.planned, toHour: 16, toMinute: 0 },
      },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("their-move") },
    );
    if (!theirs.ok) throw new Error(`the other move refused: ${theirs.reason}`);
    const afterTheirs = await contactUnderTest(store);
    act(() => rerenderControl(afterTheirs));

    // The field follows the record rather than keeping a time that now disagrees with the row above.
    expect(timeField().value).toBe("16:00");

    // And the version follows too, so the next move is not refused as stale.
    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "12:15");
    await openOverlay();
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).not.toBe(""));
    expect(outcomeText()).toContain("12:15 AWST");
    expect(toAwstParts((await contactUnderTest(store)).planned.sendAt)).toMatchObject({ hour: 12, minute: 15 });
  });

  it("rechecks the acting role at COMMIT time, and names the role it actually found", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    // Opened in a state that PERMITS the move. An interface that checked here would pass this test
    // and still record the write below.
    await openOverlay();
    expect(openOverlayId()).toBe("adjust-date-time");

    // The role changes while the confirmation sits open -- a switch in another tab, or somebody
    // else's session on the same machine.
    actingRole = "auditor";
    const beforeConfirm = requested.length;

    await userEvent.click(overlayAction());
    // WAIT FOR AN OUTCOME, ANY OUTCOME, before asserting anything. Waiting on the sentence this case
    // expects would leave every assertion after it unreachable under a mutation that produced a
    // DIFFERENT outcome: the timeout would be the only failure and nothing below would ever run.
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    // NAMED, and named with the role it actually found rather than the one the screen rendered for.
    // The service's own refusal for the same state does not carry the role, so this fires the moment
    // the recheck stops happening at the commit and the write is left to be refused at the far end.
    expect(outcomeText()).toContain("auditor");
    expect(outcomeText()).toContain("not granted the action that moves a contact");
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
    // And the recheck really did happen at the commit -- the session was read again after the open.
    expect(requested.slice(beforeConfirm)).toContain(SESSION_ENDPOINT);
  });

  it("refuses when the acting role cannot be re-read at all, and writes nothing", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();

    // The service can no longer answer who is acting. It would still WRITE if asked -- the fallback
    // for an unreadable role cookie is the coordinator -- so this refusal has something real to
    // prevent, and the assertions below are about a store that could have changed.
    actingRole = null;
    const beforeConfirm = requested.length;

    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    // THE CLAUSE THE STANDING DISCIPLINE SAYS NOBODY WRITES: a refusal appearing on screen is not
    // evidence that nothing was written.
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
    // Strictly stronger than the line above, and behind it deliberately: the write was never even
    // attempted. Nothing falsifies this one without also falsifying that one, so it is recorded as a
    // strengthening rather than as an independently proven claim.
    expect(requested.slice(beforeConfirm).filter((url) => url.startsWith(CONTACT_ENDPOINT))).toEqual([]);
    expect(outcomeText()).toContain("could not be read again");
  });

  it("rechecks the connection at COMMIT time, and does not reach the service at all", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();

    setOnline(false);
    const beforeConfirm = requested.length;

    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).not.toBe(""));

    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
    expect(outcomeText()).toContain("There is no connection");
    // Not one request, to either endpoint: an offline commit must not depend on a fetch failing.
    expect(requested.slice(beforeConfirm)).toEqual([]);
  });

  it("is refused when somebody else moved the same contact first, and leaves their move standing", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    // Somebody else's move lands after this screen rendered and before this one is confirmed. The
    // version this control holds is now behind, which is exactly what the check exists for.
    const stored = await contactUnderTest(store);
    const theirs = await store.rescheduleContact(
      {
        planId: PLAN_ID,
        contactId: stored.contact.id,
        expectedContactVersion: stored.contact.version,
        change: { contact: stored.planned, toHour: 15, toMinute: 0 },
      },
      { actor: COORDINATOR, idempotencyKey: idempotencyKey("someone-else") },
    );
    if (!theirs.ok) throw new Error(`the other move refused: ${theirs.reason}`);
    const afterTheirs = await contactUnderTest(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    await userEvent.click(overlayAction());

    // NOT "somebody else". The store answers `stale-version` for any write against a version it has
    // moved past and does not say what moved it -- and before the version was tracked in state, the
    // thing that had moved it was most often this screen's own previous write.
    await waitFor(() => expect(outcomeText()).toContain("This contact changed after this screen read it"));
    // The record still holds THEIR time, not this screen's. "Refused" alone would not say that.
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(afterTheirs));
    expect(toAwstParts((await contactUnderTest(store)).planned.sendAt)).toMatchObject({ hour: 15, minute: 0 });
  });

  it("keeps a refusal standing on the decision control itself, focusable and named", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    actingRole = "auditor";
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).toContain("not granted the action that moves a contact"));

    // Re-opening states the refusal where the decision is made rather than only behind on the page.
    await openOverlay();
    const action = overlayAction();
    expect(action.getAttribute("aria-disabled")).toBe("true");
    // FOCUSABLE. `disabled` would remove the tab stop, and the reason would never be reached by the
    // keyboard user it was written for -- so the two attributes are never both present.
    expect(action.hasAttribute("disabled")).toBe(false);
    const describedBy = action.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? "")?.textContent ?? "").toContain(
      "not granted the action that moves a contact",
    );
  });

  it("clears a standing refusal only when the recheck passes", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "11:30");
    await openOverlay();
    actingRole = "auditor";
    await userEvent.click(overlayAction());
    await waitFor(() => expect(outcomeText()).toContain("not granted the action that moves a contact"));

    // The condition has NOT lifted, so the recovery action must not clear the refusal.
    await userEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(outcomeText()).toContain("not granted the action that moves a contact"));
    await openOverlay();
    expect(overlayAction().getAttribute("aria-disabled")).toBe("true");
    act(() => window.history.back());
    await waitFor(() => expect(openOverlayId()).toBeNull());

    // Now it has.
    actingRole = "coordinator";
    await userEvent.click(screen.getByRole("button", { name: /Check again/ }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Check again/ })).toBeNull());
    await openOverlay();
    expect(overlayAction().getAttribute("aria-disabled")).toBeNull();
  });
});

/**
 * The three exports this module publishes for a test to use.
 *
 * They were exported with a comment saying a test would walk them, and no such test existed --
 * a promise in a doc comment is not coverage, and a later dead-code sweep would have been entitled
 * to read the comment as a consumer. These are that walk.
 */
describe("what the control publishes", () => {
  it("raises only overlays the frozen table marks as mutating", () => {
    // The premise, so this cannot pass on an empty list.
    expect(SCHEDULE_MOVE_OVERLAYS).toEqual(["adjust-date-time", "outside-window-warning"]);
    for (const id of SCHEDULE_MOVE_OVERLAYS) {
      expect(MUTATING_OVERLAY_IDS, `${id} is not a mutating row`).toContain(id);
    }
    // The negative half is about the FROZEN TABLE, not about the list above -- `toEqual` already
    // determines that list completely, so any further claim about its contents cannot fail. What can
    // fail is this: the loop above would be vacuous if every id in the table were mutating, and
    // `delivery-detail` is the row that proves it is not.
    expect(MUTATING_OVERLAY_IDS).not.toContain("delivery-detail");
  });

  it("reads a wall-clock field, and refuses anything that is not one", () => {
    expect(parseInputTime("09:05")).toEqual({ hour: 9, minute: 5 });
    expect(parseInputTime("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseInputTime("23:59")).toEqual({ hour: 23, minute: 59 });
    // An empty field, a partial one, an out-of-range hour and an out-of-range minute. A screen that
    // accepted "24:00" would hand the domain an instant on the following day.
    expect(parseInputTime("")).toBeNull();
    expect(parseInputTime("9:05")).toBeNull();
    expect(parseInputTime("24:00")).toBeNull();
    expect(parseInputTime("09:60")).toBeNull();
  });

  it("gives plain words for a named refusal, and names an unrecognised one rather than hiding it", () => {
    expect(moveRefusalWording("stale-version")).toContain("This contact changed after this screen read it");
    expect(moveRefusalWording("service-stopped")).toContain("Sending is stopped across the whole service");
    // Owner decision (2026-09-26): a time that has already passed is refused by name, and said plainly.
    expect(moveRefusalWording("contact-move-time-already-passed")).toContain("it has already passed");
    // An unrecognised reason is passed on as the service gave it. A reason somebody can quote is
    // worth more than a general apology.
    expect(moveRefusalWording("some-new-refusal")).toContain('named the reason "some-new-refusal"');
    // `constructor` resolves to a FUNCTION on an ordinary object literal, and a `!== undefined` guard
    // would return it -- React renders a function as nothing, leaving a refusal paragraph that is
    // empty.
    //
    // `Object.hasOwn` IS WHAT STOPS THAT, on its own. This comment used to credit the null-prototype
    // record as well, and mutation T25 showed that half is inert: removing `Object.create(null)`
    // leaves every assertion here green, because `Object.hasOwn({}, "constructor")` is false either
    // way. The null prototype stays as belt-and-braces -- it is what would save a lookup somebody
    // later rewrote as `map[key] ?? fallback` -- but it is not the guard this case proves.
    expect(moveRefusalWording("constructor")).toContain('named the reason "constructor"');
    expect(moveRefusalWording("toString")).toContain("Nothing was changed.");
  });
});

describe("a time this service may not send at", () => {
  it("raises the warning from the domain's own window rule, on the exact hour it excludes", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    // 17:59 is inside. The latest approved hour is EXCLUSIVE, and this pair is what stops the
    // wording on the screen from claiming a bound the rule does not check.
    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "17:59");
    await openOverlay();
    expect(openOverlayId()).toBe("adjust-date-time");
    act(() => window.history.back());
    await waitFor(() => expect(openOverlayId()).toBeNull());

    // A time control emits one completed browser change; typing partial values makes jsdom sanitise it to "".
    fireEvent.change(timeField(), { target: { value: "18:00" } });
    await openOverlay();
    expect(openOverlayId()).toBe("outside-window-warning");
  });

  it("says a No change outcome, distinguishably from a success, and writes nothing", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    const before = await renderControl(store);
    const scheduled = timeField().value;

    await userEvent.clear(timeField());
    await userEvent.type(timeField(), "07:15");
    await openOverlay();
    expect(openOverlayId()).toBe("outside-window-warning");

    const beforeConfirm = requested.length;
    await userEvent.click(overlayAction());

    await waitFor(() => expect(outcomeText()).toContain("nothing outside this browser happened"));
    // DISTINGUISHABLE FROM SUCCESS. Both outcomes end in "nothing was sent"; only one of them says a
    // time was recorded, and a No change that borrowed the success sentence would be the whole
    // defect this assertion exists for.
    expect(outcomeText()).not.toContain("Recorded on the plan");
    expect(stateOf(await contactUnderTest(store))).toBe(stateOf(before));
    expect(requested.slice(beforeConfirm)).toEqual([]);
    // The recovery: the scenario clears because the field returned to the time it was scheduled for.
    expect(timeField().value).toBe(scheduled);
  });

  it("states the window as the rule checks it, with the exclusive bound spelled out", async () => {
    const store = newStore();
    await seedPlan(store);
    installService(store);
    await renderControl(store);

    const helper = screen.getByText(/send time may be changed only within the day/);
    // The POSITIVE half first, so this cannot pass by finding no text at all.
    expect(helper.textContent).toContain("up to but not including 6:00 pm AWST");
    // And the shape the previous two overclaims in this programme took: a closed range that reads as
    // though 6:00 pm were inside it.
    expect(helper.textContent).not.toMatch(/9:00 am to 6:00 pm/);
  });
});
