import { defineConfig } from "vitest/config";
import config from "./vitest.config.js";

// Explicit source-focused development subset, not an acceptance/release gate.
// Replace include rather than merge arrays: merging would retain the full glob.
export default defineConfig({
  ...config,
  test: {
    ...config.test,
    include: [
      "action-registry",
      "action-registry-lifecycle",
      "bounded-search",
      "catalog-snapshot-store",
      "compiler-cache",
      "compiler-ownership",
      "configuration",
      "continuity-core",
      "continuity-rendering",
      "discovery-index",
      "fabric-exec-contract",
      "info-catalog",
      "json-budget",
      "local-line-index",
      "local-read-many",
      "projection-noise",
      "schema-validation",
      "workspace-binding",
    ].map(name => `tests/${name}.test.ts`),
  },
});
