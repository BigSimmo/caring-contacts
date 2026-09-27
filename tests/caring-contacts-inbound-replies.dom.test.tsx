// tests/caring-contacts-inbound-replies.dom.test.tsx
//
// Incoming text messages (2026-09-26): where a patient's reply reaches a person. The two surfaces
// (`RepliesToCheck` on Today, `PatientReplies` on the patient's page), the "Mark followed up"
// button, and the two pages that read replies through the audited seam -- rendered against the
// real demo store, with a reply filed by the real receiver.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  store: { current: null as unknown },
  cookies: { current: {} as Record<string, { value: string } | undefined> },
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({ get: (name: string) => mocks.cookies.current[name] })),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));
vi.mock("@/lib/caring-contacts-server/store", () => ({
  caringContactsStore: async () => mocks.store.current,
}));

import { InboundReplyFollowUpButton } from "@/components/caring-contacts/workspace/inbound-reply-follow-up-button";
import { PatientReplies, RepliesToCheck } from "@/components/caring-contacts/workspace/inbound-replies";
import { createDemoWorkspaceStore } from "@/lib/caring-contacts-server/demo-seed";
import { CARING_CONTACTS_ROLE_COOKIE, DEMO_TEAM_ID, demoActorForRole } from "@/lib/caring-contacts-server/session";
import type { AccessRecord } from "@/lib/caring-contacts/access-audit";
import { fixedClock } from "@/lib/caring-contacts/clock";
import { actorId, patientId, planId, teamId } from "@/lib/caring-contacts/ids";
import { receiveInboundTextMessage } from "@/lib/caring-contacts/inbound-receiver";
import {
  inboundSenderKey,
  type InboundReplyRecord,
  type InboundReplyWithText,
} from "@/lib/caring-contacts/inbound-replies";
import type { CaringContactRole } from "@/lib/caring-contacts/permissions";
import type { CaringContactRepository } from "@/lib/caring-contacts/repository";
import { createSimulatedTransport } from "@/lib/caring-contacts/transport/simulated";

import { CARING_CONTACTS_PROHIBITED_LANGUAGE } from "./helpers/caring-contacts-prohibited-language";

const RECEIVED = new Date("2026-09-26T02:05:00.000Z"); // 10:05 am AWST

function reply(overrides: Partial<InboundReplyWithText> = {}): InboundReplyWithText {
  return {
    id: "reply-abcdefgh12",
    planId: planId("demo-seed-plan-rowan"),
    patientId: patientId("demo-seed-patient-rowan"),
    teamId: teamId("TEAM-A"),
    kind: "reply",
    receivedAt: RECEIVED,
    planPaused: false,
    followedUpAt: null,
    followedUpBy: null,
    version: 1,
    text: "Thanks, doing ok this week.",
    ...overrides,
  };
}

function withoutText(record: InboundReplyWithText): InboundReplyRecord {
  const copy: Partial<InboundReplyWithText> = { ...record };
  delete copy.text;
  return copy as InboundReplyRecord;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.router.refresh.mockClear();
});

describe("RepliesToCheck (Today)", () => {
  it("lists each waiting reply by patient, kind and time, linking to the patient, without the words", () => {
    render(
      <RepliesToCheck
        replies={[
          withoutText(reply({ kind: "optOutRequest", planPaused: true, id: "reply-stopstop01" })),
          withoutText(reply({ id: "reply-plainreply1" })),
        ]}
      />,
    );
    const section = screen.getByTestId("caring-contacts-replies-to-check");
    expect(within(section).getByRole("heading", { name: "Replies to check" })).toBeInTheDocument();
    expect(within(section).getByText("2 waiting · 1 stop request")).toBeInTheDocument();
    const rows = within(section).getAllByTestId("caring-contacts-reply-to-check");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText(/Stop request · plan paused/)).toBeInTheDocument();
    expect(within(rows[0]).getByText(/10:05 am AWST on 26 September 2026/)).toBeInTheDocument();
    const link = within(rows[0]).getByRole("link", { name: /Review patient/ });
    expect(link.getAttribute("href")).toContain("demo-seed-patient-rowan");
    expect(link.getAttribute("href")).toContain("demo-seed-plan-rowan");
    expect(section.textContent).not.toContain("doing ok");
  });

  it("says plainly when nothing is waiting", () => {
    render(<RepliesToCheck replies={[]} />);
    expect(screen.getByText("No patient replies are waiting for a person.")).toBeInTheDocument();
  });
});

describe("PatientReplies (patient page)", () => {
  it("shows the words, what a stop request did, and who may mark it followed up", () => {
    render(
      <PatientReplies
        mayFollowUp
        replies={[
          reply({
            kind: "optOutRequest",
            planPaused: true,
            text: "Stop, I can't do this anymore",
            id: "reply-stop00001",
          }),
          reply({
            id: "reply-done00001",
            followedUpAt: new Date("2026-09-26T04:00:00.000Z"),
            followedUpBy: actorId("demo-coordinator"),
            version: 2,
          }),
        ]}
      />,
    );
    const section = screen.getByTestId("caring-contacts-patient-replies");
    expect(within(section).getByText("1 not yet followed up")).toBeInTheDocument();
    expect(within(section).getByText("Stop, I can't do this anymore")).toBeInTheDocument();
    expect(within(section).getByText(/paused automatically\. Nothing was withdrawn/)).toBeInTheDocument();
    expect(within(section).getByText(/Followed up 12:00 pm AWST on 26 September 2026/)).toBeInTheDocument();
    expect(within(section).getAllByRole("button", { name: "Mark followed up" })).toHaveLength(1);
  });

  it("offers no button to a role that may not mark replies, and says why", () => {
    render(<PatientReplies mayFollowUp={false} replies={[reply()]} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/not part of the role you are acting in/)).toBeInTheDocument();
  });

  it("says when the words were removed by a retention clearance", () => {
    render(<PatientReplies mayFollowUp replies={[reply({ text: "" })]} />);
    expect(screen.getByText(/words of this reply were removed/)).toBeInTheDocument();
  });

  it("renders nothing for a plan with no replies", () => {
    const { container } = render(<PatientReplies mayFollowUp replies={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("uses none of the workspace's prohibited words", () => {
    const { container } = render(
      <>
        <RepliesToCheck replies={[withoutText(reply({ kind: "optOutRequest", planPaused: true }))]} />
        <PatientReplies
          mayFollowUp={false}
          replies={[reply({ kind: "optOutRequest", planPaused: false, text: "STOP" }), reply({ text: "" })]}
        />
      </>,
    );
    expect(container.textContent ?? "").not.toMatch(CARING_CONTACTS_PROHIBITED_LANGUAGE);
  });
});

describe("InboundReplyFollowUpButton", () => {
  it("posts the plan, version and one idempotency key, then refreshes the page", async () => {
    const fetchMock = vi.fn(async () => Response.json({ value: {} }, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<InboundReplyFollowUpButton planId="demo-seed-plan-rowan" replyId="reply-abcdefgh12" version={3} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark followed up" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Marked followed up."));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/caring-contacts/inbound-replies/reply-abcdefgh12");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ planId: "demo-seed-plan-rowan", expectedVersion: 3 });
    expect(String(body.idempotencyKey)).toMatch(/^REPLY-FOLLOW-UP-[A-Za-z0-9-]+$/);
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it("names a refusal in plain words and reuses the same key on a second press", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ refusal: "inbound-reply-already-followed-up" }, { status: 422 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<InboundReplyFollowUpButton planId="demo-seed-plan-rowan" replyId="reply-abcdefgh12" version={1} />);
    const button = screen.getByRole("button", { name: "Mark followed up" });
    await userEvent.click(button);
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Someone has already marked this reply followed up."),
    );
    await userEvent.click(screen.getByRole("button", { name: "Mark followed up" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const keys = fetchMock.mock.calls.map(
      (call) =>
        (JSON.parse(String((call as unknown as [string, RequestInit])[1].body)) as { idempotencyKey: string })
          .idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });

  it("says nothing was recorded when the request never reached the service", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    render(<InboundReplyFollowUpButton planId="p" replyId="reply-abcdefgh12" version={1} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark followed up" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/Nothing was recorded/));
  });
});

// ---------------------------------------------------------------------------
// The two pages, against the demo store with a real reply filed.
// ---------------------------------------------------------------------------

describe("the pages that read replies", () => {
  let store: CaringContactRepository;
  let recorded: AccessRecord[];

  beforeEach(async () => {
    const base = await createDemoWorkspaceStore(fixedClock("2026-09-26T02:00:00.000Z"));
    recorded = [];
    store = Object.create(base, {
      recordAccess: {
        value: async (record: AccessRecord) => {
          await base.recordAccess(record);
          recorded.push(record);
        },
      },
    });
    mocks.store.current = store;
    const report = await receiveInboundTextMessage({
      store,
      transport: createSimulatedTransport(),
      teamIds: [DEMO_TEAM_ID],
      message: { from: "0491 570 156", text: "Stop, I can't do this anymore", carrierMessageId: "dom-1" },
      senderKey: inboundSenderKey("+61491570156", "d".repeat(40)),
    });
    expect(report.recorded).toBeGreaterThan(0);
  });

  function actAs(role: CaringContactRole) {
    mocks.cookies.current = { [CARING_CONTACTS_ROLE_COOKIE]: { value: role } };
  }

  it("Today lists the reply without its words, and records the read", async () => {
    actAs("coordinator");
    const { default: TodayPage } = await import("@/app/caring-contacts/page");
    const element = (await TodayPage()) as ReactElement<{ children: ReactElement }>;
    render(element.props.children);
    const section = screen.getByTestId("caring-contacts-replies-to-check");
    expect(within(section).getAllByTestId("caring-contacts-reply-to-check").length).toBeGreaterThan(0);
    expect(section.textContent).not.toContain("can't do this");
    expect(recorded).toContainEqual(
      expect.objectContaining({ kind: "search", objectType: "inboundReply", outcome: "allowed" }),
    );
  });

  it("Today shows no replies list, and makes no replies read, for a role that may not read them", async () => {
    actAs("auditor");
    const { default: TodayPage } = await import("@/app/caring-contacts/page");
    const element = (await TodayPage()) as ReactElement<{ children: ReactElement }>;
    render(element.props.children);
    expect(screen.queryByTestId("caring-contacts-replies-to-check")).toBeNull();
    expect(recorded.filter((record) => record.objectType === "inboundReply")).toEqual([]);
  });

  it("the patient's page shows the words and the button, and records the read", async () => {
    actAs("coordinator");
    const { default: PatientPage } = await import("@/app/caring-contacts/patients/[patientId]/page");
    const element = (await PatientPage({
      params: Promise.resolve({ patientId: "demo-seed-patient-rowan" }),
      searchParams: Promise.resolve({}),
    })) as ReactElement<{ children: ReactElement }>;
    render(element.props.children);
    const section = screen.getByTestId("caring-contacts-patient-replies");
    expect(within(section).getByText("Stop, I can't do this anymore")).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "Mark followed up" })).toBeInTheDocument();
    expect(recorded).toContainEqual(
      expect.objectContaining({
        kind: "view",
        objectType: "inboundReply",
        objectId: "demo-seed-plan-rowan",
        outcome: "allowed",
      }),
    );
    expect(demoActorForRole("coordinator").teamId).toBe(DEMO_TEAM_ID);
  });
});
