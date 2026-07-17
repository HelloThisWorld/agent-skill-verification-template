import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "coverage/**",
      "reports/**",
      "fixtures/**",
      "observability/**",
      ".agent-skill-verification/**",
      "tmp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The core intentionally moves unknown JSON through typed boundaries.
      "@typescript-eslint/no-explicit-any": "off",
      // tsc (noUnusedLocals) already enforces this with better TS awareness.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        AbortController: "readonly",
        TextDecoder: "readonly",
        TextEncoder: "readonly",
      },
    },
    rules: {
      // Data-generation scripts keep reference constants for documentation.
      "@typescript-eslint/no-unused-vars": ["error", { varsIgnorePattern: "^[A-Z0-9_]+$" }],
    },
  },
);
