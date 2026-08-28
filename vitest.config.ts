import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Process-heavy Kiro, residency, and agent suites share child-process and
    // filesystem lifecycles. Keep file execution serial so the mandatory check
    // cannot make unrelated suites contend for those resources.
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
  },
});
