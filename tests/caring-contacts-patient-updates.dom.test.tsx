// tests/caring-contacts-patient-updates.dom.test.tsx
//
// "Record a change" and "Check the number" on the patient/plan screen
// (`src/components/caring-contacts/workspace/patient-updates/`), plus the Resume explanation they
// owe `plan-actions.tsx`. Fetch is mocked to the shared contract's request and response shapes:
// these cases are about what a coordinator sees and what is sent, not about the store, whose own
// contract tests cover what the service does with it.

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() },
}));

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => mocks.router,
}));

import { MobileCheckPanel } from "@/components/caring-contacts/workspace/patient-updates/mobile-check-panel";
import {
  diedOnProblem,
  mobilePairProblem,
  offeredUpdates,
  type MobileCheckView,
  type PatientUpdatesContext,
} from "@/components/caring-contacts/workspace/patient-updates/patient-update-rules";
import {
  RecordAChange,
  type PatientUpdateDetail,
} from "@/components/caring-contacts/workspace/patient-updates/record-a-change";
import { PlanActions } from "@/components/caring-contacts/workspace/plan-actions";
import type { PlanActionsContext } from "@/components/caring-contacts/workspace/plan-action-rules";
import { CARING_CONTACT_ROLE_WORDING } from "@/lib/caring-contacts/permissions";
import type { PlanState } from "@/lib/caring-contacts/model";

const PLAN = "plan-updates-1";
const PLAN_URL = `/api/caring-contacts/plans/${PLAN}`;
const CHECK_URL = `${PLAN_URL}/mobile-check`;
const SHARED_URL = "/api/caring-contacts/patients/shared-mobile";

const NOT_CHECKED: MobileCheckView = { state: "notChecked", sentAt: null, resolvedAt: null };

function context(overrides: Partial<PatientUpdatesContext> = {}): PatientUpdatesContext {
  return {
    planId: PLAN,
    planState: "active",
    planVersion: 3,
    mobileCheck: NOT_CHECKED,
    granted: { hospitalEvents: true, death: true },
    ...overrides,
  };
}

const DETAIL: PatientUpdateDetail = {
  patientName: "Rowan Sample",
  preferredName: "Rowan",
  patientMobileNumber: "+61 491 570 156",
};

/** A plan record in the contract's shape: only what the screen reads is filled in. */
function recordAnswer(state: PlanState, version: number, mobileCheck: MobileCheckView = NOT_CHECKED) {
  return { plan: { id: PLAN, teamId: "team-1", state, version }, mobileCheck };
}

type Sent = { url: string; body: Record<string, unknown> };
type Answer = { status: number; body: unknown } | "network-failure";

/** Answers each URL from a queue (last answer repeats), and records every request made. */
function mockFetch(answers: Record<string, Answer[]>) {
  const sent: Sent[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    sent.push({ url, body: JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<string, unknown> });
    const queue = answers[url];
    if (queue === undefined || queue.length === 0) throw new Error(`no answer mocked for ${url}`);
    const answer = queue.length > 1 ? queue.shift()! : queue[0];
    if (answer === "network-failure") throw new TypeError("Failed to fetch");
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  return { sent, spy, to: (url: string) => sent.filter((entry) => entry.url === url) };
}

beforeEach(() => {
  mocks.router.refresh.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("which changes are offered, and to whom", () => {
  it("offers nothing to a role without the capability", () => {
    const { container } = render(
      <RecordAChange context={context({ granted: { hospitalEvents: false, death: false } })} detail={DETAIL} />,
    );
    expect(container).toBeEmptyDOMElement();
    const panel = render(<MobileCheckPanel context={context({ granted: { hospitalEvents: false, death: false } })} />);
    expect(panel.container).toBeEmptyDOMElement();
  });

  it("offers only the death to a role that holds the safety stop alone", () => {
    render(<RecordAChange context={context({ granted: { hospitalEvents: false, death: true } })} detail={DETAIL} />);
    expect(screen.getByTestId("caring-contacts-update-death")).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-update-readmission")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-update-mobile-block")).toBeNull();
    expect(screen.queryByTestId("caring-contacts-update-name")).toBeNull();
  });

  it("offers no edit and no check on an ended plan, and the correction only on a cancelled one", () => {
    const granted = { hospitalEvents: true, death: true };
    expect(offeredUpdates({ granted }, "withdrawn")).toEqual({
      readmission: false,
      death: false,
      deathCorrection: false,
      contactDetail: false,
      mobileCheck: false,
    });
    expect(offeredUpdates({ granted }, "cancelled")).toEqual({
      readmission: false,
      death: false,
      deathCorrection: true,
      contactDetail: false,
      mobileCheck: false,
    });
    // A draft cannot be held, so a readmission is not offered; everything else that applies is.
    expect(offeredUpdates({ granted }, "draft")).toMatchObject({ readmission: false, death: true, mobileCheck: true });

    render(<RecordAChange context={context({ planState: "cancelled" })} detail={DETAIL} />);
    expect(screen.getByTestId("caring-contacts-update-death-correction")).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-update-death")).toBeNull();
    expect(screen.getByText(/does not restart this plan/)).toBeInTheDocument();
    expect(screen.getByText(/a new referral is needed/)).toBeInTheDocument();
  });

  it("does not offer the name or number edits when the episode could not be read", () => {
    render(<RecordAChange context={context()} detail={null} />);
    expect(screen.getByTestId("caring-contacts-update-readmission")).toBeInTheDocument();
    expect(screen.queryByTestId("caring-contacts-update-mobile-block")).toBeNull();
  });
});

describe("recording a readmission", () => {
  it("says messages pause, the calendar stays, and nothing restarts by itself; then sends the event", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [PLAN_URL]: [
        { status: 200, body: { value: { record: recordAnswer("paused", 4), exceptions: [], contactsCancelled: 0 } } },
      ],
    });
    render(<RecordAChange context={context()} detail={DETAIL} />);

    const block = screen.getByTestId("caring-contacts-update-readmission-block");
    expect(block).toHaveTextContent("pauses this plan straight away");
    expect(block).toHaveTextContent("The calendar is not moved");
    expect(block).toHaveTextContent("Nothing restarts by itself");

    await user.click(within(block).getByRole("button", { name: "Record a readmission" }));
    expect(fetched.sent).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Yes, record the readmission" }));

    await waitFor(() => expect(fetched.to(PLAN_URL)).toHaveLength(1));
    const body = fetched.to(PLAN_URL)[0].body;
    expect(body).toMatchObject({ action: "recordEvent", event: "readmission", expectedVersion: 3 });
    expect(body).not.toHaveProperty("diedOn");
    expect(String(body.idempotencyKey)).toMatch(/^PLAN-READMISSION-[a-p]{32}$/);

    const outcome = screen.getByTestId("caring-contacts-record-a-change-outcome");
    await waitFor(() => expect(outcome).toHaveTextContent("Readmitted to hospital — recorded on the plan"));
    expect(outcome).toHaveTextContent("nothing restarts by itself");
    expect(mocks.router.refresh).toHaveBeenCalled();
  });

  it("carries the version the last answer gave into the next change, so it is not refused as stale", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [PLAN_URL]: [
        { status: 200, body: { value: { record: recordAnswer("paused", 4), exceptions: [], contactsCancelled: 0 } } },
        { status: 200, body: { value: { record: recordAnswer("paused", 5), mobileChanged: false, exceptions: [] } } },
      ],
    });
    render(<RecordAChange context={context()} detail={DETAIL} />);
    await user.click(screen.getByRole("button", { name: "Record a readmission" }));
    await user.click(screen.getByRole("button", { name: "Yes, record the readmission" }));
    await waitFor(() => expect(fetched.to(PLAN_URL)).toHaveLength(1));

    const name = screen.getByLabelText("Preferred name (optional)");
    await user.clear(name);
    await user.type(name, "Ro");
    await user.click(screen.getByRole("button", { name: "Save the name" }));
    await waitFor(() => expect(fetched.to(PLAN_URL)).toHaveLength(2));
    expect(fetched.to(PLAN_URL)[1].body).toMatchObject({
      action: "updateContactDetail",
      preferredName: "Ro",
      expectedVersion: 4,
    });
    expect(fetched.to(PLAN_URL)[1].body).not.toHaveProperty("patientName");
    expect(fetched.to(PLAN_URL)[1].body).not.toHaveProperty("patientMobileNumber");
  });

  it("states a stale-version refusal in plain words, and reuses the key when the same press is retried", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [PLAN_URL]: ["network-failure", { status: 409, body: { refusal: "stale-version" } }],
    });
    render(<RecordAChange context={context()} detail={DETAIL} />);
    await user.click(screen.getByRole("button", { name: "Record a readmission" }));
    await user.click(screen.getByRole("button", { name: "Yes, record the readmission" }));
    const outcome = screen.getByTestId("caring-contacts-record-a-change-outcome");
    await waitFor(() => expect(outcome).toHaveTextContent("This did not reach the service"));

    await user.click(screen.getByRole("button", { name: "Record a readmission" }));
    await user.click(screen.getByRole("button", { name: "Yes, record the readmission" }));
    await waitFor(() => expect(outcome).toHaveTextContent("This plan changed after this screen read it"));
    const [first, second] = fetched.to(PLAN_URL);
    expect(second.body.idempotencyKey).toBe(first.body.idempotencyKey);
  });
});

describe("recording a death", () => {
  it("cannot be confirmed until the irreversible consequence is acknowledged, and says it plainly", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [PLAN_URL]: [
        {
          status: 200,
          body: { value: { record: recordAnswer("cancelled", 4), exceptions: [], contactsCancelled: 9 } },
        },
      ],
    });
    render(<RecordAChange context={context()} detail={DETAIL} />);

    await user.click(screen.getByRole("button", { name: "Record that the patient has died" }));
    const confirmation = screen.getByTestId("caring-contacts-update-death-confirmation");
    expect(confirmation).toHaveTextContent("This cannot be undone.");
    expect(confirmation).toHaveTextContent("will be cancelled for good");
    expect(confirmation).toHaveTextContent("this plan can never restart");

    const confirm = screen.getByTestId("caring-contacts-update-death-confirm");
    expect(confirm).toHaveAttribute("aria-disabled", "true");
    await user.click(confirm);
    expect(fetched.sent).toHaveLength(0);

    await user.type(screen.getByLabelText("Date of death (optional)"), "2026-09-20");
    await user.click(screen.getByTestId("caring-contacts-update-death-understood"));
    expect(confirm).not.toHaveAttribute("aria-disabled");
    await user.click(confirm);

    await waitFor(() => expect(fetched.to(PLAN_URL)).toHaveLength(1));
    expect(fetched.to(PLAN_URL)[0].body).toMatchObject({
      action: "recordEvent",
      event: "death",
      diedOn: "2026-09-20",
      expectedVersion: 3,
    });
    const outcome = screen.getByTestId("caring-contacts-record-a-change-outcome");
    await waitFor(() => expect(outcome).toHaveTextContent("9 unsent messages were cancelled"));
    expect(outcome).toHaveTextContent("it can never restart");
    // The plan is now cancelled, so the correction is what is offered, and the death is not.
    expect(screen.queryByTestId("caring-contacts-update-death")).toBeNull();
    expect(screen.getByTestId("caring-contacts-update-death-correction")).toBeInTheDocument();
  });

  it("sends no date when none is given, and refuses a date after today", () => {
    expect(diedOnProblem("", "2026-09-26")).toBeNull();
    expect(diedOnProblem("2026-09-26", "2026-09-26")).toBeNull();
    expect(diedOnProblem("2026-09-27", "2026-09-26")).toMatch(/cannot be later than today/);
  });
});

describe("changing the mobile number", () => {
  it("needs the number typed twice, matching once normalised", () => {
    expect(mobilePairProblem("0412 345 678", "")).toMatch(/Type the mobile number again/);
    expect(mobilePairProblem("0412 345 678", "0412 345 679")).toMatch(/do not match/);
    expect(mobilePairProblem("0412 345 678", "+61412345678")).toBeNull();
    expect(mobilePairProblem("0412 345 678", "  0412345678 ")).toBeNull();
    expect(mobilePairProblem("08 9222 2222", "08 9222 2222")).toMatch(/Australian mobile/);
  });

  it("warns when the number is on another open plan, and will not save until the tick is given", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [SHARED_URL]: [{ status: 200, body: { sharedWith: 2 } }],
      [PLAN_URL]: [
        { status: 200, body: { value: { record: recordAnswer("paused", 4), mobileChanged: true, exceptions: [] } } },
      ],
    });
    render(<RecordAChange context={context()} detail={DETAIL} />);
    const block = screen.getByTestId("caring-contacts-update-mobile-block");
    expect(block).toHaveTextContent("Changing the number pauses this plan");
    expect(block).toHaveTextContent("lets the plan run again");
    expect(block).toHaveTextContent("Nothing restarts by itself");

    await user.type(screen.getByLabelText("New mobile number"), "0412 345 678");
    await user.type(screen.getByLabelText("Type the mobile number again"), "0412345679");
    await user.click(screen.getByTestId("caring-contacts-update-mobile-save"));
    expect(screen.getByTestId("caring-contacts-update-mobile-problem")).toHaveTextContent("do not match");
    expect(fetched.sent).toHaveLength(0);

    await user.clear(screen.getByLabelText("Type the mobile number again"));
    await user.type(screen.getByLabelText("Type the mobile number again"), "+61412345678");

    const warning = await screen.findByTestId("caring-contacts-update-mobile-shared");
    expect(warning).toHaveTextContent("2 other open plans in this team use this same number");
    expect(fetched.to(SHARED_URL)).toHaveLength(1);
    expect(fetched.to(SHARED_URL)[0].body).toEqual({ mobile: "+61 412 345 678", excludePlanId: PLAN });

    const save = screen.getByTestId("caring-contacts-update-mobile-save");
    expect(save).toHaveAttribute("aria-disabled", "true");
    await user.click(save);
    expect(fetched.to(PLAN_URL)).toHaveLength(0);
    expect(screen.getByTestId("caring-contacts-update-mobile-problem")).toHaveTextContent("Tick the box");

    await user.click(screen.getByRole("checkbox", { name: "I have checked this number is right" }));
    await user.click(save);
    await waitFor(() => expect(fetched.to(PLAN_URL)).toHaveLength(1));
    expect(fetched.to(PLAN_URL)[0].body).toMatchObject({
      action: "updateContactDetail",
      patientMobileNumber: "+61 412 345 678",
      expectedVersion: 3,
    });
    expect(fetched.to(PLAN_URL)[0].body).not.toHaveProperty("patientName");
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-record-a-change-outcome")).toHaveTextContent(
        "this plan is paused. No message will go until someone has checked the number and lets the plan run again",
      ),
    );
    // The boxes are cleared once the number is saved.
    expect(screen.getByLabelText("New mobile number")).toHaveValue("");
  });

  it("asks for no tick when no other plan shares the number, and asks for one when the check fails", async () => {
    const user = userEvent.setup();
    mockFetch({ [SHARED_URL]: [{ status: 200, body: { sharedWith: 0 } }] });
    const first = render(<RecordAChange context={context()} detail={DETAIL} />);
    await user.type(screen.getByLabelText("New mobile number"), "0412 345 678");
    await user.type(screen.getByLabelText("Type the mobile number again"), "0412 345 678");
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-update-mobile-save")).not.toHaveAttribute("aria-disabled"),
    );
    expect(screen.queryByTestId("caring-contacts-update-mobile-shared")).toBeNull();
    first.unmount();
    vi.restoreAllMocks();

    mockFetch({ [SHARED_URL]: [{ status: 500, body: { refusal: "read-failed" } }] });
    render(<RecordAChange context={context()} detail={DETAIL} />);
    await user.type(screen.getByLabelText("New mobile number"), "0412 345 678");
    await user.type(screen.getByLabelText("Type the mobile number again"), "0412 345 678");
    const warning = await screen.findByTestId("caring-contacts-update-mobile-shared");
    expect(warning).toHaveTextContent("could not check whether another plan");
    expect(screen.getByTestId("caring-contacts-update-mobile-save")).toHaveAttribute("aria-disabled", "true");
  });

  it("refuses the number the plan already holds without sending anything", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({});
    render(<RecordAChange context={context()} detail={DETAIL} />);
    await user.type(screen.getByLabelText("New mobile number"), "0491 570 156");
    await user.type(screen.getByLabelText("Type the mobile number again"), "0491570156");
    await user.click(screen.getByTestId("caring-contacts-update-mobile-save"));
    expect(screen.getByTestId("caring-contacts-record-a-change-outcome")).toHaveTextContent(
      "Nothing was different from what the plan already holds",
    );
    expect(fetched.sent).toHaveLength(0);
  });
});

describe("checking the number", () => {
  it("states each state in words", () => {
    const states: [MobileCheckView, string][] = [
      [NOT_CHECKED, "Not checked"],
      [
        { state: "awaitingConfirmation", sentAt: "2026-09-26T02:00:00.000Z", resolvedAt: null },
        "Waiting for the patient to confirm",
      ],
      [{ state: "confirmed", sentAt: "2026-09-26T02:00:00.000Z", resolvedAt: "2026-09-26T02:05:00.000Z" }, "Confirmed"],
      [
        { state: "notReceived", sentAt: "2026-09-26T02:00:00.000Z", resolvedAt: "2026-09-26T02:05:00.000Z" },
        "Did not arrive",
      ],
    ];
    for (const [mobileCheck, wording] of states) {
      const view = render(<MobileCheckPanel context={context({ mobileCheck })} />);
      expect(screen.getByTestId("caring-contacts-mobile-check-state")).toHaveTextContent(`Number check: ${wording}`);
      view.unmount();
    }
  });

  it("sends a test text, then records the patient's answer", async () => {
    const user = userEvent.setup();
    const fetched = mockFetch({
      [CHECK_URL]: [
        {
          status: 200,
          body: {
            value: {
              record: recordAnswer("active", 4, {
                state: "awaitingConfirmation",
                sentAt: "2026-09-26T02:00:00.000Z",
                resolvedAt: null,
              }),
            },
          },
        },
        {
          status: 200,
          body: {
            value: {
              record: recordAnswer("active", 5, {
                state: "confirmed",
                sentAt: "2026-09-26T02:00:00.000Z",
                resolvedAt: "2026-09-26T02:05:00.000Z",
              }),
            },
          },
        },
      ],
    });
    render(<MobileCheckPanel context={context()} />);
    expect(screen.queryByRole("button", { name: "It arrived" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Send a test text" }));
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-mobile-check-state")).toHaveTextContent(
        "Waiting for the patient to confirm",
      ),
    );
    expect(fetched.to(CHECK_URL)[0].body).toMatchObject({ action: "send", expectedVersion: 3 });
    expect(screen.getByRole("button", { name: "It did not arrive" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "It arrived" }));
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-mobile-check-state")).toHaveTextContent("Number check: Confirmed"),
    );
    expect(fetched.to(CHECK_URL)[1].body).toMatchObject({ action: "confirm", outcome: "received", expectedVersion: 4 });
  });

  it("names a failed send in plain words", async () => {
    const user = userEvent.setup();
    mockFetch({ [CHECK_URL]: [{ status: 409, body: { refusal: "mobile-check-send-failed" } }] });
    render(<MobileCheckPanel context={context()} />);
    await user.click(screen.getByRole("button", { name: "Send a test text" }));
    await waitFor(() =>
      expect(screen.getByTestId("caring-contacts-mobile-check-outcome")).toHaveTextContent(
        "The test text could not be sent",
      ),
    );
    expect(screen.getByTestId("caring-contacts-mobile-check-state")).toHaveTextContent("Not checked");
  });
});

describe("where Resume is offered", () => {
  function actions(overrides: Partial<PlanActionsContext> = {}): PlanActionsContext {
    return {
      planId: PLAN,
      planState: "paused",
      planVersion: 3,
      actingAccount: "coordinator",
      actingAccountWording: CARING_CONTACT_ROLE_WORDING.coordinator,
      actingActorId: "demo-coordinator",
      carriedBy: { actorId: "demo-coordinator", wording: CARING_CONTACT_ROLE_WORDING.coordinator },
      destinations: [],
      granted: { pause: true, resume: true, withdrawal: true, reassignment: true, cancelDraft: true, claim: true },
      ...overrides,
    };
  }

  it("explains, before the press, that an unconfirmed number stops the plan running again", () => {
    const view = render(<PlanActions context={actions({ mobileCheckState: "notReceived" })} />);
    expect(screen.getByTestId("caring-contacts-plan-action-resume-mobile-check")).toHaveTextContent("did not arrive");
    view.unmount();
    render(<PlanActions context={actions({ mobileCheckState: "confirmed" })} />);
    expect(screen.queryByTestId("caring-contacts-plan-action-resume-mobile-check")).toBeNull();
  });

  it("states the mobile-check-unconfirmed refusal in plain words", async () => {
    const user = userEvent.setup();
    mockFetch({ [PLAN_URL]: [{ status: 409, body: { refusal: "mobile-check-unconfirmed" } }] });
    render(<PlanActions context={actions()} />);
    await user.click(screen.getByTestId("caring-contacts-plan-action-resume"));
    const outcome = screen.getByTestId("caring-contacts-plan-action-outcome");
    await waitFor(() => expect(outcome).toHaveTextContent("The patient's number has not been confirmed yet"));
    expect(outcome).toHaveTextContent("Check the number");
    expect(outcome).not.toHaveTextContent("has not been taught");
  });
});
