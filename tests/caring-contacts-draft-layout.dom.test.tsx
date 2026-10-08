import { render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import CaringContactsLayout from "@/app/caring-contacts/layout";
import { endBrowserSession } from "@/lib/caring-contacts-browser-session";
import { signProductionSession } from "@/lib/caring-contacts-server/session-token";

const state = vi.hoisted(() => ({ live: false, cookie: "" }));
vi.mock("@/lib/caring-contacts-server/workspace-gate", async (original) => ({
  ...(await original<typeof import("@/lib/caring-contacts-server/workspace-gate")>()),
  isCaringContactsLiveEnabled: () => state.live,
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.cookie }) }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`Synthetic redirect: ${url}`);
  },
}));
afterEach(() => {
  endBrowserSession();
  vi.unstubAllEnvs();
  state.live = false;
  state.cookie = "";
});

describe("live workspace draft binding", () => {
  it("leaves demo children available without an account boundary", async () => {
    render(await CaringContactsLayout({ children: <p>Synthetic demo</p> }));
    expect(screen.getByText("Synthetic demo")).toBeInTheDocument();
  });

  it("binds only identity and expiry from the verified live cookie", async () => {
    state.live = true;
    const secret = "synthetic-offline-hmac-for-draft-layout-only";
    vi.stubEnv("CARING_CONTACTS_SESSION_HMAC_SECRET", secret);
    state.cookie = signProductionSession(
      {
        actorId: "synthetic-A",
        teamId: "synthetic-team",
        roles: ["coordinator"],
        exp: Math.floor(Date.now() / 1000) + 60,
      },
      secret,
    );
    const layout = await CaringContactsLayout({ children: <p>Synthetic live child</p> });
    // Server HTML must keep non-wizard screens usable without hydration/JavaScript.
    expect(renderToStaticMarkup(layout)).toContain("Synthetic live child");
    render(layout);
    expect(screen.getByText("Synthetic live child")).toBeInTheDocument();
    const owner = JSON.parse(window.sessionStorage.getItem("caring-contacts:plan-draft-owner")!);
    expect(owner.actorId).toBe("synthetic-A");
    expect(owner.teamId).toBe("synthetic-team");
    expect(Object.keys(owner).sort()).toEqual(["actorId", "expiresAt", "teamId"]);
  });

  it("refuses an invalid cookie before any draft reader is rendered", async () => {
    state.live = true;
    state.cookie = "invalid-synthetic-cookie";
    await expect(CaringContactsLayout({ children: <p>Must not mount</p> })).rejects.toThrow(
      "Synthetic redirect: /api/caring-contacts/auth/sign-in",
    );
    expect(screen.queryByText("Must not mount")).toBeNull();
  });
});
