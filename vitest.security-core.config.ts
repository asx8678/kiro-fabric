import { defineConfig } from "vitest/config";

// Portable security regression lane. Keep this list focused on host-independent
// contracts so every supported CI OS exercises the same security core.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "tests/kiro-workspace-context.test.ts",
      "tests/kiro-environment.test.ts",
      "tests/kiro-mcp-confined.test.ts",
      "tests/pi-tools-confinement.test.ts",
      "tests/kiro-installer.test.ts",
      "tests/kiro-process-lifecycle.test.ts",
      "tests/output-budget.test.ts",
      "tests/kiro-memory-security.test.ts",
      "tests/kiro-power.test.ts",
      "tests/kiro-power-manifest.test.ts",
      "tests/kiro-security-core-policy.test.ts",
      "tests/native-kiro-fixture.test.ts",
      "tests/power-skill-validation.test.ts",
    ],
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
    testTimeout: 30_000,
  },
});
