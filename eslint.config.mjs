// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "test/fixtures/**",
      "pi-fabric/**",
      "repos/**",
      "coverage/**",
      ".fabric-lite/**",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    files: ["scripts/**/*.mjs"],
    rules: {
      // The interactive installer uses many best-effort empty catches by design.
      "no-empty": "off",
    },
  },
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      // This codebase deliberately matches and rejects control characters in
      // tool output (binary detection, ANSI stripping) and escapes '/' in
      // regexes for readability; both rules would forbid correct code here.
      "no-control-regex": "off",
      "no-useless-escape": "off",
    },
  },
);
