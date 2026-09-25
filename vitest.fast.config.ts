import { defineConfig } from "vitest/config";
import config from "./vitest.config.js";

// RETIRED: the source-focused development subset was removed with the bulk
// test-suite deletion; every name this config listed no longer exists. `test:fast`
// now routes to scripts/qualification-unavailable.mjs (fail-closed). Kept as an
// explicit empty selector so a stray `vitest --config vitest.fast.config.ts`
// reports "no test files" instead of silently matching the full glob.
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: [],
  },
});
