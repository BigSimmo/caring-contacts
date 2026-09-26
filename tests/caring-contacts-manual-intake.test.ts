import { describe, expect, it } from "vitest";

import {
  awstDateTimeLocalToIso,
  formatAwstConfirmation,
  formatAwstDateTimeLocal,
} from "@/components/caring-contacts/workspace/manual-intake-form";

describe("manual Caring Contacts intake", () => {
  it("initializes datetime-local values from the AWST wall clock", () => {
    expect(formatAwstDateTimeLocal(new Date("2026-09-12T02:34:00.000Z"))).toBe("2026-09-12T10:34");
  });

  it("converts datetime-local as Australia/Perth (+08:00), not the browser timezone", () => {
    expect(awstDateTimeLocalToIso("2026-09-12T10:34")).toBe("2026-09-12T02:34:00.000Z");
  });

  it("renders confirmation timestamps explicitly in Australia/Perth", () => {
    const rendered = formatAwstConfirmation("2026-09-12T02:34:00.000Z");
    expect(rendered).toMatch(/12/);
    expect(rendered).toMatch(/10:34|10\.34/);
    expect(rendered.toLowerCase()).toMatch(/awst|gmt\+8|utc\+8|\+08/);
  });
});
