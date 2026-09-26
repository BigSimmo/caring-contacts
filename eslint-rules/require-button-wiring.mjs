/**
 * Local ESLint rule: an explicit `<button type="button">` must be wired to a
 * behaviour — an event handler, a form action, or an explicit disabled state.
 *
 * `type="button"` opts a button out of form submission, so on its own it does
 * *nothing* when clicked. Such a button that carries no `onClick` and no
 * `disabled`/`aria-disabled` state is a control that advertises an action it
 * cannot perform — the "Language and region" globe defect
 * (master-search-header.tsx, fixed 2026-07-21). This rule makes that class of
 * dead button fail `npm run lint`.
 *
 * Deliberately narrow to keep false positives at zero:
 *  - Only `<button>` elements whose `type` is the string literal `"button"` are
 *    inspected. Submit/reset buttons and buttons with a dynamic/absent `type`
 *    (which may default to submit inside a <form>) are left alone.
 *  - Any spread ({...props}) skips the element, since a handler may arrive
 *    dynamically (same escape hatch as require-lucide-icon-aria).
 *  - An explicitly inert control is expressed the codebase's way — `disabled` or
 *    `aria-disabled` (typically with a "coming soon" note) — and passes.
 *
 * Which of the two to reach for is a real decision, not a stylistic one, and
 * `docs/wiring-conventions.md` is where it is made: a control that is
 * unavailable for a *stated reason* (feature not built, this record has no such
 * data) carries `aria-disabled="true"` plus an inert handler, because the native
 * attribute removes the tab stop and the reason then cannot be reached by
 * keyboard. A control that is merely *transiently* inert — a request in flight,
 * a pager at its last page, a form action awaiting validity — keeps native
 * `disabled`. This rule accepts both, since both are genuinely wired.
 *
 * What it does NOT accept is the two together (see `hasRedundantDisabledPair`).
 *
 * There is no auto-fix: wiring a button requires knowing what it should do, so
 * the fix is a human decision (add the handler, or make it an explicit
 * disabled placeholder). Design-scratch mockups are exempt via eslint.config.mjs.
 */

/** Attribute names (besides `onClick`) that mark a <button type="button"> as wired. */
const EXPLICIT_WIRING_ATTRS = new Set(["disabled", "aria-disabled"]);

/** True when the JSX attribute is `type="button"` (string literal). */
function isTypeButton(attr) {
  if (attr.type !== "JSXAttribute") return false;
  if (attr.name.type !== "JSXIdentifier" || attr.name.name !== "type") return false;
  const { value } = attr;
  if (!value) return false;
  if (value.type === "Literal") return value.value === "button";
  // `type={"button"}` — a literal wrapped in an expression container.
  if (value.type === "JSXExpressionContainer" && value.expression.type === "Literal") {
    return value.expression.value === "button";
  }
  return false;
}

/**
 * True when a JSX attribute value is a *statically-known* value that means "off":
 * a literal `false`/`null`, the string `"false"`, or the identifier `undefined`
 * (bare or inside an expression container). Anything dynamic — an identifier,
 * call, arrow function, member access, ternary — is unknown at lint time and is
 * NOT treated as off, so it keeps passing (same fail-open stance as the spread
 * escape hatch). A bare boolean attribute (`disabled`, no value) is `true`.
 */
function isStaticallyOff(value) {
  if (value == null) return false; // bare boolean attribute → `true`, not off
  const nodeIsOff = (node) =>
    node.type === "Literal"
      ? node.value === false || node.value === null || node.value === "false"
      : node.type === "Identifier" && node.name === "undefined";
  if (value.type === "Literal") return nodeIsOff(value);
  if (value.type === "JSXExpressionContainer") return nodeIsOff(value.expression);
  return false;
}

/**
 * True when the attribute actually wires click behaviour with a live value. Only
 * `onClick` counts as a handler: other `on*` events (onFocus/onMouseEnter) leave
 * a click doing nothing, and `formAction` has no submit effect on a non-submit
 * button. A statically-known "off" value does not wire or disable the button —
 * `onClick={null}`, `disabled={false}`, and `aria-disabled="false"` are treated
 * as unwired, while dynamic values and `aria-disabled="true"` remain valid.
 */
function isWiringAttr(attr) {
  if (attr.type !== "JSXAttribute") return false;
  if (attr.name.type !== "JSXIdentifier") return false;
  const name = attr.name.name;
  if (name !== "onClick" && !EXPLICIT_WIRING_ATTRS.has(name)) return false;
  return !isStaticallyOff(attr.value);
}

/**
 * True when a `<button>` carries BOTH a live native `disabled` and a live
 * `aria-disabled` — the shape that reads as belt-and-braces and is not.
 *
 * The native attribute wins on focus: the element leaves the tab order whatever
 * `aria-disabled` says, so the pairing buys nothing and actively hides the bug.
 * Every site that carried it also carried an `aria-describedby` reason that no
 * keyboard user could reach, which is what made it worth gating rather than
 * merely documenting (ledger `#291`).
 *
 * Statically-off values are excluded on both sides, so `disabled={false}` beside
 * `aria-disabled="true"` — a legitimate way to spell a conditional placeholder —
 * still passes, as does any pair where the aria side is `"false"`.
 */
function hasLiveAttr(attributes, name) {
  return attributes.some(
    (attr) =>
      attr.type === "JSXAttribute" &&
      attr.name.type === "JSXIdentifier" &&
      attr.name.name === name &&
      !isStaticallyOff(attr.value),
  );
}

function hasRedundantDisabledPair(attributes) {
  return hasLiveAttr(attributes, "disabled") && hasLiveAttr(attributes, "aria-disabled");
}

/**
 * True when a button advertises `aria-disabled` without an inert (or any) click
 * handler. Native `disabled` is itself inert; `aria-disabled` is not — without
 * an onClick that prevents activation the control stays fully operable, which
 * is the opposite of the unavailable-placeholder contract.
 */
function hasAriaDisabledWithoutHandler(attributes) {
  return (
    hasLiveAttr(attributes, "aria-disabled") &&
    !hasLiveAttr(attributes, "disabled") &&
    !hasLiveAttr(attributes, "onClick")
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        'Require an explicit `<button type="button">` to carry an onClick handler or an explicit disabled state.',
    },
    schema: [],
    messages: {
      unwired:
        'This <button type="button"> has no onClick and no disabled/aria-disabled state — it does nothing when clicked. Wire it with onClick, or make it an explicit disabled "coming soon" placeholder.',
      redundantDisabledPair:
        'This <button> carries both `disabled` and `aria-disabled` — the native attribute wins on focus, so the aria one changes nothing and the control still leaves the tab order. Keep `disabled` alone for a transiently inert control, or `aria-disabled="true"` plus an inert onClick when the control is unavailable for a stated reason a keyboard user needs to reach.',
      ariaDisabledNeedsHandler:
        "This <button> carries `aria-disabled` without an onClick — unlike native `disabled`, aria-disabled does not block activation. Add an inert onClick (for example `ignoreUnavailableActivation`) so the control stays reachable but does nothing.",
    },
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type !== "JSXIdentifier" || node.name.name !== "button") return;
        // The redundant pairing is wrong on any button, not just type="button",
        // and must run before the spread escape: explicit `disabled` +
        // `aria-disabled` after `{...props}` still create the forbidden pair
        // (native wins on focus regardless of anything the spread injects).
        if (hasRedundantDisabledPair(node.attributes)) {
          context.report({ node, messageId: "redundantDisabledPair" });
          return;
        }
        // Same for aria-disabled without a handler: an explicit attribute after
        // a spread still leaves the control operable unless onClick is present.
        if (hasAriaDisabledWithoutHandler(node.attributes)) {
          context.report({ node, messageId: "ariaDisabledNeedsHandler" });
          return;
        }
        // A spread may inject a handler dynamically — don't flag unwired.
        if (node.attributes.some((attr) => attr.type === "JSXSpreadAttribute")) return;
        // Only inspect explicit type="button"; submit/reset/dynamic are out of scope.
        if (!node.attributes.some((attr) => isTypeButton(attr))) return;
        if (node.attributes.some((attr) => isWiringAttr(attr))) return;
        context.report({ node, messageId: "unwired" });
      },
    };
  },
};

export default rule;
