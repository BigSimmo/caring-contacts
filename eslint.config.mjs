import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import noHardcodedHex from "./eslint-rules/no-hardcoded-hex.mjs";
import requireButtonWiring from "./eslint-rules/require-button-wiring.mjs";
import requireLucideIconAria from "./eslint-rules/require-lucide-icon-aria.mjs";
import requireZIndexLadder from "./eslint-rules/require-z-index-ladder.mjs";
import restrictSuppressHydrationWarning from "./eslint-rules/restrict-suppress-hydration-warning.mjs";

// The five local rules came with the code from PsychSift, where they were enforced on it.
// Every block that uses the `local` namespace must point at this same object.
const localRulesPlugin = {
  rules: {
    "no-hardcoded-hex": noHardcodedHex,
    "require-button-wiring": requireButtonWiring,
    "require-lucide-icon-aria": requireLucideIconAria,
    "require-z-index-ladder": requireZIndexLadder,
    "restrict-suppress-hydration-warning": restrictSuppressHydrationWarning,
  },
};

// The clickable design prototypes are design scratch (closed in production) and are exempt
// from the product-UI rules.
const MOCKUP_IGNORES = ["src/app/mockups/**", "**/*-mockups/**", "src/components/caring-contacts/mockups/**"];

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{jsx,tsx}"],
    rules: {
      // A <label> that is not wired to a control is a real accessibility fault.
      "jsx-a11y/label-has-associated-control": "error",
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    ignores: MOCKUP_IGNORES,
    plugins: { local: localRulesPlugin },
    rules: {
      // Icons must be decorative (aria-hidden) or carry an accessible name.
      "local/require-lucide-icon-aria": "error",
      // A non-submit button must have a handler or be explicitly disabled.
      "local/require-button-wiring": "error",
      // Colours come from design tokens, not hex literals.
      "local/no-hardcoded-hex": "error",
      // Only the agreed z-index rungs.
      "local/require-z-index-ladder": "error",
    },
  },
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: { local: localRulesPlugin },
    rules: {
      "local/restrict-suppress-hydration-warning": "error",
    },
  },
  {
    // Working app code must never import the design prototypes.
    files: ["src/**/*.{ts,tsx}"],
    ignores: MOCKUP_IGNORES,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/mockups", "**/mockups/*", "**/*-mockups", "**/*-mockups/*"],
              message: "The working app must not import the design prototypes (they are closed in production).",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    ".next/**",
    ".next-playwright/**",
    ".cache/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
]);
