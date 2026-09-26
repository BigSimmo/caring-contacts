// Standalone extract: copied unchanged from PsychSift; src/lib/theme.ts is a byte-for-byte copy.
import { describe, expect, it, vi } from "vitest";
import {
  APP_THEME_COLORS,
  nextTheme,
  readThemeCookie,
  readThemePreference,
  resolveThemePreference,
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE_NAME,
  THEME_STORAGE_KEY,
} from "../src/lib/theme";

describe("theme helpers", () => {
  it("uses stored explicit theme before system preference", () => {
    expect(resolveThemePreference("dark", false)).toBe("dark");
    expect(resolveThemePreference("light", true)).toBe("light");
  });

  it("falls back to system preference when no stored theme exists", () => {
    expect(resolveThemePreference(null, true)).toBe("dark");
    expect(resolveThemePreference(undefined, false)).toBe("light");
  });

  it("toggles between light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("keeps installed-app browser chrome aligned with both application themes", () => {
    // A deliberate tripwire on the exact values: these paint before any
    // stylesheet loads, so an accidental edit here is a flash of the wrong page
    // colour. The pin is only half the story — it went stale when --background
    // moved and this assertion did not, so the light value tracking
    // the root-mounted v2 layer is enforced in tests/design-token-contract.test.ts.
    expect(APP_THEME_COLORS).toEqual({ light: "#ffffff", dark: "#0b0e11" });
  });

  it("still applies the OS dark theme when localStorage is blocked", () => {
    const classes = new Set(["ckb-v2"]);
    const toggle = vi.fn((name: string, force: boolean) => {
      if (force) classes.add(name);
      else classes.delete(name);
    });
    const setAttribute = vi.fn();
    const run = new Function("localStorage", "window", "document", THEME_BOOTSTRAP_SCRIPT);

    run(
      {
        getItem() {
          throw new DOMException("Blocked", "SecurityError");
        },
      },
      { matchMedia: () => ({ matches: true }) },
      {
        documentElement: { classList: { toggle } },
        querySelectorAll: () => [{ setAttribute }],
      },
    );

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(classes).toEqual(new Set(["ckb-v2", "dark"]));
    expect(setAttribute).toHaveBeenCalledWith("content", APP_THEME_COLORS.dark);
  });

  it("reads the appearance preference from the stored value", () => {
    expect(readThemePreference("light")).toBe("light");
    expect(readThemePreference("dark")).toBe("dark");
    // No pin and stale/system values both resolve to "system" so the OS
    // preference keeps flowing through the resolved theme.
    expect(readThemePreference(null)).toBe("system");
    expect(readThemePreference(undefined)).toBe("system");
    expect(readThemePreference("system")).toBe("system");
    expect(readThemePreference("sepia")).toBe("system");
  });

  it("exports stable storage and cookie keys shared with layout + useTheme", () => {
    expect(THEME_STORAGE_KEY).toBe("clinical-kb-theme");
    expect(THEME_COOKIE_NAME).toBe("clinical-theme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_STORAGE_KEY);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_COOKIE_NAME);
  });

  it("parses an explicit theme pin from the cookie string", () => {
    expect(readThemeCookie(`${THEME_COOKIE_NAME}=dark`)).toBe("dark");
    expect(readThemeCookie(`a=1; ${THEME_COOKIE_NAME}=light; b=2`)).toBe("light");
    expect(readThemeCookie(`${THEME_COOKIE_NAME}=system`)).toBeNull();
    expect(readThemeCookie("")).toBeNull();
  });

  it("falls back to the theme cookie when localStorage has no pin", () => {
    const toggle = vi.fn();
    const setAttribute = vi.fn();
    const run = new Function("localStorage", "window", "document", THEME_BOOTSTRAP_SCRIPT);

    run(
      {
        getItem() {
          return null;
        },
      },
      { matchMedia: () => ({ matches: false }) },
      {
        cookie: `${THEME_COOKIE_NAME}=dark`,
        documentElement: { classList: { toggle } },
        querySelectorAll: () => [{ setAttribute }],
      },
    );

    expect(toggle).toHaveBeenCalledWith("dark", true);
    expect(setAttribute).toHaveBeenCalledWith("content", APP_THEME_COLORS.dark);
  });
});
