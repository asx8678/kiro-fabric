import { defineConfig } from "vitest/config";

import { PROCESS_LIFECYCLE_TEST_FILES } from "./vitest.test-groups.js";

export default defineConfig({
  test: {
    environment: "node",
    include: [...PROCESS_LIFECYCLE_TEST_FILES],
    fileParallelism: false,
    maxWorkers: 1,
    restoreMocks: true,
  },
});
