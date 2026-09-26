/**
 * Local ESLint rule: enforce z-index ladder allowed rungs.
 * Validates all z-[<n>] utilities against allowed rungs:
 * 0, 5, 10, 20, 30, 40, 60, 80-85, 95, 100, 110
 *
 * Rung 5 is reserved for interstitial chrome that must sit above a z-0
 * backdrop but below the z-10 command/suggestion surface (privacy notice).
 * Rung 110 is --z-toast: outcome announcements must sit above --z-modal (100).
 */

const ALLOWED_RUNGS = new Set([0, 5, 10, 20, 30, 40, 60, 80, 81, 82, 83, 84, 85, 95, 100, 110]);

/** @type {import("eslint").Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Enforce z-index ladder allowed rungs.",
    },
    schema: [],
    messages: {
      invalid:
        "Z-index value z-[{{value}}] is not allowed. Allowed rungs: 0, 5, 10, 20, 30, 40, 60, 80-85, 95, 100, 110.",
    },
  },
  create(context) {
    const checkString = (node, value) => {
      const regex = /\bz-\[(\d+)\](?:\s|$)/g;
      let match;
      while ((match = regex.exec(value)) !== null) {
        const num = parseInt(match[1], 10);
        if (!ALLOWED_RUNGS.has(num)) {
          context.report({
            node,
            messageId: "invalid",
            data: { value: match[1] },
          });
        }
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === "string") {
          checkString(node, node.value);
        }
      },
      TemplateElement(node) {
        if (typeof node.value.raw === "string") {
          checkString(node, node.value.raw);
        }
      },
    };
  },
};

export default rule;
