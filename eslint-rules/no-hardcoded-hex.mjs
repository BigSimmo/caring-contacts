/**
 * Local ESLint rule: forbid hardcoded hex Tailwind colour utilities such as
 * `bg-[#…]`, `text-[#…]`, and `border-[#…]` so themes must use semantic CSS
 * variables (e.g. `var(--surface)`).
 */

const rule = {
  meta: {
    type: "problem",
    docs: {
      description: "Prevent hardcoded hex color utilities in Tailwind classNames",
    },
    schema: [],
  },
  create(context) {
    const hexPattern = /\b(bg|text|border)-\[#[0-9a-fA-F]{3,8}\]/;

    return {
      Literal(node) {
        if (typeof node.value === "string" && hexPattern.test(node.value)) {
          context.report({
            node,
            message:
              "Hardcoded hex color utilities (bg-[#...], text-[#...], border-[#...]) are forbidden. Use semantic CSS variables (e.g. var(--surface)) to support theming.",
          });
        }
      },
      TemplateElement(node) {
        if (node.value && node.value.raw && hexPattern.test(node.value.raw)) {
          context.report({
            node,
            message:
              "Hardcoded hex color utilities (bg-[#...], text-[#...], border-[#...]) are forbidden. Use semantic CSS variables (e.g. var(--surface)) to support theming.",
          });
        }
      },
    };
  },
};

export default rule;
