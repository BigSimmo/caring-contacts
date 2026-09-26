# Caring Contact accessibility acceptance

## Navigation and focus

- Every major surface has a real Next.js destination and an inbound link.
- Page navigation moves natural focus to the level-one heading and announces the destination.
- Overlay state is represented in the URL, supports browser history and restores focus to the originating control on close.
- Session expiry remains modal and action-only; offline status remains non-modal and does not trap focus.
- Dialog and sheet background content is inert and background scrolling is blocked through the shared `Sheet` contract.

## Controls and feedback

- All visible actions navigate, submit, open a contextual surface or expose a named unavailable reason.
- Persistently unavailable actions remain focusable with `aria-disabled` and an associated reason.
- Transiently busy controls may use native `disabled` only while an operation is in progress.
- Mutation success, guard rejection, no-change outcomes and recovery are announced through the shared live announcer.
- Protected irreversible decisions provide explicit confirmation language and a visible fresh-auth checkpoint.

## Responsive and zoom

- Required review widths: 320, 390, 430, 768, 1024, 1440 and 1920 CSS pixels.
- Phone content remains below the effective top safe area and scrolls clear of the bottom dock.
- Controls provide at least a 44 by 44 CSS-pixel target in compact layouts.
- Data tables become labelled record cards where a table would force horizontal page scrolling.
- At 400% zoom on a 1280-pixel viewport, the page reflows to a compact composition without horizontal document scrolling.
- Long names, service labels and larger text wrap without clipping or hiding their associated status.

## Perception and motion

- Status is communicated through text/icon/structure, never colour alone.
- Clinical Sky marks navigation and selection; Graphite marks decisive commands; green, amber and red retain verified, attention and critical semantic roles.
- Dark roles use repository tokens rather than inverted hard-coded colours.
- Forced-colour mode retains visible borders, selected states and focus indicators.
- Reduced-motion mode removes non-essential movement without removing state feedback.

## Browser evidence boundary

Focused Chromium evidence covers keyboard, focus, responsive geometry, dark, forced-colour, reduced-motion and zoom-reflow contracts. It does not constitute physical iPhone Safari or installed-PWA acceptance; those remain separate device checks.

## Physical iPhone & iOS PWA Motion Acceptance Matrix

Ledger `#S4K1GA`.

Physical testing on iOS devices (Safari mobile browser and Standalone Installed PWA) must satisfy the following acceptance criteria across system motion preferences:

| Setting / Mode                                                                                                   | Environment                 | Component / Element                              | Required Visual & Animation State                                                                                                                 | Verification Method                                                  |
| :--------------------------------------------------------------------------------------------------------------- | :-------------------------- | :----------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------- |
| **Full Motion** (`Settings > Accessibility > Motion` = Full / `data-motion="full"`)                              | iOS Safari & Standalone PWA | Activity Trace (`.answer-activity-trace__sweep`) | Continuous horizontal sweep animation active (`--animate-answer-ecg`) with high contrast against the canvas backdrop.                             | Visual sweep cadence inspection on physical device.                  |
| **Full Motion**                                                                                                  | iOS Safari & Standalone PWA | Step Status Spinners (`.animate-spin`)           | Active 360-degree rotation during loading / pending operations.                                                                                   | Visual rotation verification.                                        |
| **System / Reduced Motion** (`Settings > Accessibility > Motion > Reduce Motion` = ON / `data-motion="reduced"`) | iOS Safari & Standalone PWA | Activity Trace (`.answer-activity-trace__sweep`) | Animation halted (`animation: none`). Trace remains **statically visible** (`opacity: 0.55`); MUST NOT disappear or render as an empty blank box. | Inspect ECG line opacity and confirm lack of horizontal translation. |
| **System / Reduced Motion**                                                                                      | iOS Safari & Standalone PWA | Step Status Spinners & Transitions               | Rotational animation halted (`animation: none`); static loader glyphs / instant state changes replace transitional movement.                      | Verify instant state switch without jarring shifts or blank states.  |

### Acceptance Invariants:

1. **Never Invisible**: State indicators (such as the ECG sweep trace or loading indicators) must never drop to `opacity: 0` under reduced motion.
2. **Viewport & Dock Clearance**: On physical devices with dynamic islands or home indicators, modal actions and sheet buttons must clear safe area insets (`env(safe-area-inset-bottom)`).
