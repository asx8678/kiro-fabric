import { defineConfig } from "vitest/config";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

export default defineConfig({
  test: {
    environment: "node",
    // macOS /var is a symlink to /private/var. Fixtures must use canonical roots
    // just like production; never relax private-path checks to accommodate aliases.
    env: { TMPDIR: realpathSync(tmpdir()) },
    include: ["tests/**/*.test.ts"],
    restoreMocks: true,
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
