export type ResolvedTheme = "light" | "dark";

/**
 * User-facing appearance choice. "system" follows the OS `prefers-color-scheme`
 * while "light"/"dark" pin the theme regardless of the OS. Only "light" and
 * "dark" are persisted; "system" is represented by the absence of a stored
 * value so the OS preference keeps flowing through on later visits.
 */
export type ThemePreference = ResolvedTheme | "system";

export const DEFAULT_THEME: ResolvedTheme = "dark";

/* Must equal the resolved `--background` for each root-mounted v2 theme in
   ckb-v2-tokens.css. These are painted by the browser (and the pre-hydration
   script) before any CSS is available, so a drift here shows up as a flash of
   the wrong page colour and a mismatched browser chrome bar. Re-check both
   whenever the v2 --background moves. */
export const APP_THEME_COLORS = {
  light: "#ffffff",
  dark: "#0b0e11",
} as const satisfies Record<ResolvedTheme, string>;

/** localStorage key for an explicit light/dark pin. */
export const THEME_STORAGE_KEY = "clinical-kb-theme";

/**
 * Cookie mirror of an explicit light/dark pin so the server layout can paint
 * the correct `<html>` class before hydration. Cleared for "system".
 */
export const THEME_COOKIE_NAME = "clinical-theme";

/**
 * Runs before paint. Storage is deliberately isolated so privacy modes that
 * throw on localStorage still receive their OS-selected theme. When localStorage
 * has no explicit pin, fall back to the `clinical-theme` cookie so a
 * cookie-only preference (matching RootLayout) is not immediately overwritten.
 *
 * Both catches swallow deliberately, and each says so inline. This runs before
 * React mounts, so there is no logger or toast to report to, and every failure
 * here means the same thing: no explicit pin was readable, so the next fallback
 * in the chain (cookie, then the OS preference) applies. Surfacing the error
 * instead would trade a correct default appearance for a broken first paint.
 * Keep the inline notes to one short clause — this string ships in every
 * page's `<head>`.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem("${THEME_STORAGE_KEY}");}catch(e){/* storage blocked (private/partitioned) - fall through to the cookie, then the OS preference */}if(t!=="light"&&t!=="dark"){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE_NAME}=(light|dark)(?:;|$)/);if(m)t=m[1];}catch(e){/* cookie access blocked (sandboxed frame) - the OS preference below applies */}}var d=t==="dark"||(t!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);var c=d?"${APP_THEME_COLORS.dark}":"${APP_THEME_COLORS.light}";document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.setAttribute("content",c);});})();`;

export function resolveThemePreference(storedTheme: string | null | undefined, prefersDark: boolean): ResolvedTheme {
  if (storedTheme === "light" || storedTheme === "dark") return storedTheme;
  return prefersDark ? "dark" : "light";
}

/**
 * Maps a raw stored value to the appearance choice shown in settings. Anything
 * that is not an explicit "light"/"dark" pin (null, "system", or a stale value)
 * reads back as "system" so the control mirrors what the app actually renders.
 */
export function readThemePreference(storedTheme: string | null | undefined): ThemePreference {
  return storedTheme === "light" || storedTheme === "dark" ? storedTheme : "system";
}

export function nextTheme(currentTheme: ResolvedTheme): ResolvedTheme {
  return currentTheme === "dark" ? "light" : "dark";
}

/** Read an explicit light/dark pin from `document.cookie`, if present. */
export function readThemeCookie(cookieSource: string | null | undefined): ResolvedTheme | null {
  if (!cookieSource) return null;
  const match = cookieSource.match(new RegExp(`(?:^|;\\s*)${THEME_COOKIE_NAME}=(light|dark)(?:;|$)`));
  return match?.[1] === "light" || match?.[1] === "dark" ? match[1] : null;
}
