// tests/caring-contacts-manual-intake-form.dom.test.tsx
//
// The manual intake form's mobile-number guards: the number is typed twice and must match, and the
// team's active plans are asked whether another patient already has it. A single mistyped digit here
// would send a suicide-aftercare message to a stranger, so each guard is proved to BLOCK the save,
// not merely to show a sentence.
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ManualIntakeForm } from "@/components/caring-contacts/workspace/manual-intake-form";

const SHARED_MOBILE_PATH = "/api/caring-contacts/patients/shared-mobile";
const INTAKE_PATH = "/api/caring-contacts/intake";
const WARNING =
  "Another patient in your team's active plans has this mobile number. Check it with the patient before continuing.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Every fetch this form makes, answered: the shared-number check by `shared`, the save as accepted. */
function stubFetch(shared: () => Promise<Response>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    if (url === SHARED_MOBILE_PATH) return shared();
    if (url === INTAKE_PATH) {
      const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
      return jsonResponse({
        value: {
          referralId: "SYN-REFERRAL-NEW",
          referral: {
            ...body,
            safetyAlerts: [],
          },
        },
      });
    }
    throw new TypeError(`unexpected fetch to ${url}`);
  });
}

function callsTo(spy: ReturnType<typeof stubFetch>, path: string) {
  return spy.mock.calls.filter(([input]) => String(input) === path);
}

/** Fills every field from the invented sample, which fills the FIRST mobile entry only. */
async function fillFromSample(user: ReturnType<typeof userEvent.setup>) {
  render(<ManualIntakeForm />);
  await user.click(screen.getByRole("button", { name: "Royal Perth Hospital" }));
  const first = screen.getByLabelText(/^Mobile number/i) as HTMLInputElement;
  expect(first.value).not.toBe("");
  return first.value;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("manual intake — the mobile number is typed twice", () => {
  it("leaves the second box empty after the sample fills the first, so a person types it", async () => {
    const user = userEvent.setup();
    stubFetch(async () => jsonResponse({ value: { sharedWith: 0 } }));
    await fillFromSample(user);
    expect(screen.getByLabelText(/Type the mobile number again/i)).toHaveValue("");
  });

  it("refuses to save while the second entry differs, and says so beside the box", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => jsonResponse({ value: { sharedWith: 0 } }));
    const mobile = await fillFromSample(user);

    // One digit changed at the end.
    const last = mobile.slice(-1);
    const wrong = `${mobile.slice(0, -1)}${last === "9" ? "8" : String(Number(last) + 1)}`;
    const again = screen.getByLabelText(/Type the mobile number again/i);
    await user.type(again, wrong);

    expect(again).toHaveAttribute("aria-invalid", "true");
    const problem = screen.getByTestId("mobile-number-again-problem");
    expect(problem).toHaveTextContent(/do not match/);
    expect(again.getAttribute("aria-describedby") ?? "").toContain(problem.id);

    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/do not match/);
    expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(0);
    expect(callsTo(fetched, SHARED_MOBILE_PATH)).toHaveLength(0);
  });

  it("saves once both entries match after normalising, and never sends the second entry", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => jsonResponse({ value: { sharedWith: 0 } }));
    const mobile = await fillFromSample(user);

    // The same number written without spaces, pasted rather than typed.
    await user.click(screen.getByLabelText(/Type the mobile number again/i));
    await user.paste(mobile.replace(/\s+/g, ""));
    expect(await screen.findByText(/No other patient in your team's active plans/)).toBeInTheDocument();

    const [, checkInit] = callsTo(fetched, SHARED_MOBILE_PATH)[0];
    expect(JSON.parse(String((checkInit as RequestInit).body))).toEqual({
      mobile: expect.stringMatching(/^\+614\d{8}$/),
    });

    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    await waitFor(() => expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(1));
    const [, init] = callsTo(fetched, INTAKE_PATH)[0];
    const body = JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>;
    expect(body.mobileNumber).toBe(mobile);
    // The route is `.strict()` and the second entry is a guard on the typing, not a value.
    expect(Object.keys(body).some((key) => /again|confirm/i.test(key))).toBe(false);
    expect(await screen.findByText("Referral saved and accepted")).toBeInTheDocument();
  });
});

describe("manual intake — another patient with the same number", () => {
  it("warns, and refuses to save until the number is ticked as checked", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => jsonResponse({ value: { sharedWith: 2 } }));
    const mobile = await fillFromSample(user);
    await user.type(screen.getByLabelText(/Type the mobile number again/i), mobile);

    expect(await screen.findByText(WARNING)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/I have checked this number is right/);
    expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(0);

    await user.click(screen.getByRole("checkbox", { name: "I have checked this number is right" }));
    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    await waitFor(() => expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(1));
  });

  it("says the check could not run when it fails, and still requires the tick", async () => {
    const user = userEvent.setup();
    const fetched = stubFetch(async () => Promise.reject(new TypeError("Failed to fetch")));
    const mobile = await fillFromSample(user);
    await user.type(screen.getByLabelText(/Type the mobile number again/i), mobile);

    const result = await screen.findByTestId("mobile-number-again-shared-result");
    await waitFor(() => expect(result).toHaveTextContent(/could not run/));
    expect(result).not.toHaveTextContent(/No other patient/);

    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(0);

    const tick = within(document.body).getByRole("checkbox", { name: "I have checked this number is right" });
    await user.click(tick);
    await user.click(screen.getByRole("button", { name: /Save referral/ }));
    await waitFor(() => expect(callsTo(fetched, INTAKE_PATH)).toHaveLength(1));
  });
});
