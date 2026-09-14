import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

const vitestGlobals = Object.fromEntries(
  [
    "afterAll",
    "afterEach",
    "beforeAll",
    "beforeEach",
    "describe",
    "expect",
    "it",
    "test",
    "vi",
  ].map((name) => [name, "readonly"]),
);

export default tseslint.config(
  {
    ignores: ["build/**", "dist/**", "graphify-out/**", "node_modules/**", ".worktrees/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["src/**/*.ts", "vitest.config.ts"],
  })),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.webextensions },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      "no-empty": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
  {
    files: ["src/**/*.test.ts"],
    languageOptions: {
      globals: { ...globals.node, ...vitestGlobals },
    },
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["tools/**/*.js"],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      sourceType: "commonjs",
    },
  },
  {
    files: ["tools/**/*.mjs", "*.config.mjs"],
    languageOptions: {
      globals: globals.node,
      sourceType: "module",
    },
  },
  {
    files: ["vitest.config.ts"],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
