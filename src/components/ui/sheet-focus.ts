"use client";

/**
 * Stacked-overlay coordination for `Sheet`: open-sheet stack, body scroll lock,
 * background inerting, and the open-focus settle controller.
 *
 * Split out of `sheet.tsx` so the focus rules can be unit-tested directly
 * instead of only through a rendered Sheet, and so the stack is unambiguously a
 * single module-level singleton shared by every Sheet instance.
 *
 * Every open Sheet registers a window keydown listener and locks body scroll.
 * Without coordination two open Sheets (e.g. an image lightbox or table dialog
 * opened over the mobile Evidence sheet) both react to a single Escape —
 * closing both — and their independent per-instance scroll-lock save/restore is
 * order-dependent (an out-of-order close unlocks the page behind a still-open
 * sheet or leaks `overflow:hidden`). The stack lets only the top-most Sheet
 * handle Escape/Tab, and its length doubles as a scroll-lock ref count so body
 * scroll stays locked until the last Sheet closes and the original overflow is
 * restored exactly once.
 */

/** Marks an element this module deactivated behind the top-most sheet. */
export const SHEET_INERT_MARKER = "data-sheet-inert";
/** Opt-in marker for a portaled surface that is logically inside a sheet. */
export const SHEET_PORTAL_ATTRIBUTE = "data-sheet-portal";
/** Opt-out marker for background elements that must stay interactive. */
export const SHEET_INERT_SKIP_ATTRIBUTE = "data-sheet-inert-skip";

/**
 * How long a newly opened sheet keeps listening for the conditions that steal
 * its initial focus: a sibling sheet finishing teardown, `focus=1` hydration
 * reclaiming the composer, or a `data-sheet-autofocus` child arriving behind a
 * slow dynamic import (the DocumentDrawer Find field). Listening is idle, so
 * the window matches the widest case rather than the common one; it ends on the
 * first user interaction, when this sheet stops being top-most, or here.
 */
export const SHEET_FOCUS_SETTLE_MS = 10_000;

/**
 * Fallback re-attempt schedule, in milliseconds after the first attempt. Covers
 * focus changes that emit neither a `focusin`, a panel mutation, nor a stack
 * change. Backoff converges in the common case (target present next frame)
 * without the fixed 50ms polling this replaced.
 */
const FALLBACK_ATTEMPT_DELAYS_MS = [16, 32, 64, 128, 256];

/**
 * Ceiling on reclaims that do not stick. A component that re-focuses itself
 * from its own focus handler would otherwise trade `focus()` calls with this
 * controller synchronously until the stack blows; giving up leaves focus where
 * that surface put it. A reclaim that holds resets the count, so defending the
 * panel repeatedly over the settle window is unaffected.
 */
const MAX_CONSECUTIVE_RECLAIMS = 12;

/**
 * Elements that must keep working behind a modal: stylesheets and scripts carry
 * no focus, live regions must keep announcing (route changes, status), and the
 * Next.js dev overlay/route announcer would otherwise be unreachable.
 */
const NEVER_INERT_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "NOSCRIPT", "NEXT-ROUTE-ANNOUNCER"]);

type SheetEntry = { id: string; root: HTMLElement | null };

const openSheets: SheetEntry[] = [];
const inertedElements = new Set<HTMLElement>();
const stackListeners = new Set<() => void>();
let bodyScrollLockPreviousOverflow = "";
// The root element is locked as well as <body>, and it is the half that
// actually does the work on phones. `globals.css` sets `html { overflow-x:
// clip }`, and a root whose overflow is not `visible` stops <body>'s overflow
// from propagating to the viewport — so `body { overflow: hidden }` alone left
// the document freely scrollable behind an open sheet. Measured on a 390x844
// phone with the safety-findings sheet open: the page behind still had 272px of
// range and one wheel/touch gesture over the sheet ran it to the bottom instead
// of scrolling the sheet. Locking `overflow-y` on the root keeps the scroll
// offset (an element made `overflow: hidden` retains its scrollTop), so nothing
// jumps when the sheet closes.
let rootScrollLockPreviousOverflowY = "";

export function isTopmostSheet(id: string) {
  return openSheets[openSheets.length - 1]?.id === id;
}

export function hasOpenSheet() {
  return openSheets.length > 0;
}

/**
 * Whether a closing sheet may still return focus to `target`.
 *
 * With nothing open, always. With a sheet still open, only when the target
 * lives inside it — that is a stacked sheet handing focus back down to the
 * sheet below. A target out in the (now inert) page background belongs to a
 * sheet that was replaced rather than stacked on, and restoring it would drag
 * focus out of the sheet that took over.
 */
export function canRestoreFocusTo(target: HTMLElement | null) {
  if (target == null) return false;
  const topRoot = openSheets[openSheets.length - 1]?.root ?? null;
  if (topRoot == null) return true;
  return topRoot.contains(target);
}

/**
 * Notifies on every push/pop so the top-most sheet can re-take focus the moment
 * a sibling sheet finishes tearing down, instead of polling for it.
 */
export function subscribeToSheetStack(listener: () => void) {
  stackListeners.add(listener);
  return () => {
    stackListeners.delete(listener);
  };
}

function notifyStackListeners() {
  for (const listener of Array.from(stackListeners)) listener();
}

export function pushSheet(id: string, root: HTMLElement | null = null) {
  if (openSheets.length === 0) {
    bodyScrollLockPreviousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    rootScrollLockPreviousOverflowY = document.documentElement.style.overflowY;
    document.documentElement.style.overflowY = "hidden";
  }
  openSheets.push({ id, root });
  syncBackgroundInert();
  notifyStackListeners();
}

/** Updates a delayed portal ref after the sheet registered with a null root. */
export function updateSheetRoot(id: string, root: HTMLElement | null) {
  let entry: SheetEntry | undefined;
  for (let index = openSheets.length - 1; index >= 0; index -= 1) {
    if (openSheets[index].id === id) {
      entry = openSheets[index];
      break;
    }
  }
  if (!entry || entry.root === root) return;
  entry.root = root;
  syncBackgroundInert();
  notifyStackListeners();
}

export function popSheet(id: string) {
  for (let index = openSheets.length - 1; index >= 0; index -= 1) {
    if (openSheets[index].id === id) {
      openSheets.splice(index, 1);
      break;
    }
  }
  if (openSheets.length === 0) {
    document.body.style.overflow = bodyScrollLockPreviousOverflow;
    document.documentElement.style.overflowY = rootScrollLockPreviousOverflowY;
  }
  syncBackgroundInert();
  notifyStackListeners();
}

function canInert(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false;
  if (NEVER_INERT_TAGS.has(element.tagName) || element.tagName.startsWith("NEXTJS-")) return false;
  if (element.hasAttribute(SHEET_INERT_SKIP_ATTRIBUTE)) return false;
  if (element.hasAttribute("aria-live")) return false;
  // Never clobber an `inert` another owner set: on release we could not tell
  // whether removing it was ours to do.
  return !element.hasAttribute("inert") || inertedElements.has(element);
}

/**
 * Everything outside the sheet's own subtree: walking to `document.body` and
 * taking the siblings at each level covers both portaled sheets (a direct body
 * child) and inline sheets nested deep in the page tree.
 */
function collectBackgroundElements(root: HTMLElement) {
  const background: HTMLElement[] = [];
  let node: HTMLElement = root;
  while (node !== document.body) {
    const parent: HTMLElement | null = node.parentElement;
    if (parent == null) break;
    for (const sibling of Array.from(parent.children)) {
      if (sibling === node) continue;
      if (canInert(sibling)) background.push(sibling);
      // OverlayPortal carries a meaningful layer/name on a display:contents
      // wrapper. Inert that logical wrapper and its direct surface so both the
      // platform containment and the Sheet's historical backdrop contract stay
      // observable for stacked modals.
      if (sibling instanceof HTMLElement && sibling.hasAttribute("data-overlay-layer")) {
        for (const surface of Array.from(sibling.children)) {
          if (canInert(surface)) background.push(surface);
        }
      }
    }
    node = parent;
  }
  return background;
}

/**
 * Containment beats reclamation: while a sheet is open the rest of the page is
 * `inert`, so the browser itself refuses to move focus there. Only elements
 * present when the sheet opened are marked — a popover portaled out of the
 * sheet after it opened stays interactive.
 */
function syncBackgroundInert() {
  if (typeof document === "undefined") return;
  const topRoot = openSheets[openSheets.length - 1]?.root ?? null;
  const next =
    topRoot?.isConnected && document.body.contains(topRoot)
      ? new Set(collectBackgroundElements(topRoot))
      : new Set<HTMLElement>();

  for (const element of Array.from(inertedElements)) {
    if (next.has(element)) continue;
    element.removeAttribute("inert");
    element.removeAttribute(SHEET_INERT_MARKER);
    inertedElements.delete(element);
  }
  for (const element of next) {
    if (inertedElements.has(element)) continue;
    element.setAttribute("inert", "");
    element.setAttribute(SHEET_INERT_MARKER, "true");
    inertedElements.add(element);
  }
}

/**
 * A sheet may only take focus back from nothing (body) or from background it
 * deactivated itself. Anything else — a control inside the panel, a popover
 * portaled out of the sheet, a surface that legitimately opened on top — keeps
 * the focus the user or the app gave it.
 */
export function shouldReclaimFocus(panel: HTMLElement | null, active: Element | null) {
  if (active == null || active === document.body) return true;
  if (panel?.contains(active)) return false;
  if (active.closest(`[${SHEET_PORTAL_ATTRIBUTE}]`)) return false;
  return active.closest(`[${SHEET_INERT_MARKER}="true"]`) != null;
}

export type SheetFocusController = { cancel: () => void };

/**
 * Drives a newly opened sheet's initial focus from events rather than a poll:
 * a panel `MutationObserver` catches a late-mounted autofocus child, `focusin`
 * catches focus landing elsewhere, and the stack subscription catches a sibling
 * sheet's teardown. A short backoff chain covers anything none of those emit.
 * The window closes on success, on the first user interaction, when this sheet
 * is no longer top-most, or at `settleMs`.
 */
export function startSheetOpenFocus({
  sheetId,
  getPanel,
  resolveTarget,
  settleMs = SHEET_FOCUS_SETTLE_MS,
}: {
  sheetId: string;
  getPanel: () => HTMLElement | null;
  resolveTarget: () => HTMLElement | null;
  settleMs?: number;
}): SheetFocusController {
  let settled = false;
  // The element this controller last focused. Focus sitting there is still the
  // sheet's own opening focus, so it may be upgraded when a better target (a
  // late-mounted autofocus child) appears — unlike focus the user moved.
  let lastAppliedTarget: HTMLElement | null = null;
  let reclaims = 0;
  const timers: number[] = [];
  const teardowns: Array<() => void> = [];

  function finish() {
    if (settled) return;
    settled = true;
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
    for (const teardown of teardowns.splice(0)) teardown();
  }

  function attempt() {
    if (settled) return;
    if (!isTopmostSheet(sheetId)) {
      finish();
      return;
    }
    const target = resolveTarget();
    // No target yet: the autofocus child may still be mounting, so stay armed
    // rather than burning attempts against a node that does not exist.
    if (!target?.isConnected) return;
    const active = document.activeElement;
    if (active === target) return;
    if (active !== lastAppliedTarget && !shouldReclaimFocus(getPanel(), active)) return;
    reclaims += 1;
    if (reclaims > MAX_CONSECUTIVE_RECLAIMS) {
      finish();
      return;
    }
    target.focus({ preventScroll: true });
    if (document.activeElement === target) {
      lastAppliedTarget = target;
      // The reclaim held, so this was ordinary defence rather than a fight.
      // Only focus that is taken straight back accumulates against the budget.
      reclaims = 0;
    }
  }

  const frame = window.requestAnimationFrame(() => {
    if (settled) return;
    attempt();
    if (settled) return;
    // Stay armed after a successful first focus: the resolved target can still
    // improve (a deferred autofocus input mounting into the panel).

    const panel = getPanel();
    if (panel != null && typeof MutationObserver === "function") {
      const observer = new MutationObserver(attempt);
      observer.observe(panel, { childList: true, subtree: true });
      teardowns.push(() => observer.disconnect());
    }

    document.addEventListener("focusin", attempt);
    teardowns.push(() => document.removeEventListener("focusin", attempt));

    teardowns.push(subscribeToSheetStack(attempt));

    // A deliberate interaction outranks the sheet's opening focus.
    document.addEventListener("pointerdown", finish, true);
    document.addEventListener("keydown", finish, true);
    teardowns.push(() => {
      document.removeEventListener("pointerdown", finish, true);
      document.removeEventListener("keydown", finish, true);
    });

    for (const delay of FALLBACK_ATTEMPT_DELAYS_MS) {
      timers.push(window.setTimeout(attempt, delay));
    }
    timers.push(window.setTimeout(finish, settleMs));
  });

  teardowns.push(() => window.cancelAnimationFrame(frame));

  return {
    cancel: finish,
  };
}
