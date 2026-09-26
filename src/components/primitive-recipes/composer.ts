import { controlDisabled } from "./recipes";

/** Rounded search container that owns focus. Pair with `searchShellInput`. */
export const searchShell =
  "search-shell flex min-h-tap items-center gap-2 rounded-lg border border-[color:var(--border)] px-3";
/** Transparent nested search input. Unlayered CSS, not Tailwind `outline-none`. */
export const searchShellInput = "search-shell-input min-w-0 flex-1 bg-transparent outline-none";

export const chatAnswerText =
  "max-w-[68ch] text-base-minus font-medium leading-prose text-[color:var(--text-heading)] sm:text-base";
export const chatActionRow =
  "flex min-h-tap flex-wrap items-center gap-1.5 text-xs font-semibold text-[color:var(--text-heading)] sm:min-h-8";
export const chatMicroAction = `inline-flex min-h-tap min-w-tap items-center justify-center gap-1.5 rounded-md px-2 text-xs font-semibold text-[color:var(--text-muted)] transition hover:bg-[color:var(--clinical-accent-soft)] hover:text-[color:var(--clinical-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)] ${controlDisabled}`;
/* Composer chrome has one owner: the unlayered classes in globals.css. These
 * exports are semantic handles only, so recipes and cascade rules cannot fight
 * over input/button dimensions, states, or paint. */
export const chatComposerShellBase = "chat-composer-shell-base";
const chatComposerShellDelta = "chat-composer-shell-delta";
export const chatComposerShell = `${chatComposerShellBase} ${chatComposerShellDelta}`;
export const chatComposerInput = "chat-composer-input";
export const chatComposerIconButton = "chat-composer-icon-button";
export const chatSendButton = "chat-send-button";

export const searchPageCanvas = "bg-[color:var(--background)] text-[color:var(--text)]";
// Phone bottom-dock clearance lives on #main-content / dashboard <main> via
// --mobile-composer-reserve so it can collapse when the dock hides. Do not bake
// a second dock-sized safe-area pad into page shells.
export const searchPageShell = "min-h-0 overflow-x-clip px-3 py-3 pb-4 sm:grow sm:px-5 sm:py-5 sm:pb-8 lg:px-6";
// Standalone pages outside the search shell own the OS top inset themselves
// (apple-mobile-web-app-status-bar-style=black-translucent). Bake max(safe-area)
// into the top pad and omit py-* so cn() call sites never rely on Tailwind's
// side-vs-axis utility sort order to win over searchPageShell's py-3/sm:py-5.
export const searchPageShellStandalone =
  "min-h-0 overflow-x-clip px-3 pt-[max(0.75rem,var(--safe-area-top))] pb-4 sm:grow sm:px-5 sm:pt-[max(1.25rem,var(--safe-area-top))] sm:pb-8 lg:px-6";
export const searchPageContainer = "mx-auto w-full max-w-[1500px]";
export const searchResultsBodyGrid = "grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]";
export const searchResultsMainColumn = "search-results-main min-w-0";
export const searchResultsSidebar = "hidden w-[22rem] shrink-0 space-y-4 xl:block";
export const searchResultsSection =
  "rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)]";
export const searchFocusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--focus)]";
