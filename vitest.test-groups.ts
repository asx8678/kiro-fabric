// Suites that own real child-process or durable participant lifecycles run in a
// dedicated serial lane. All other tests retain Vitest's normal file-level
// parallelism, so one slow integration group does not serialize the full suite.
export const PROCESS_LIFECYCLE_TEST_FILES = [
  "tests/actor-manager.test.ts",
  "tests/agent-cwd.test.ts",
  "tests/agent-manager.test.ts",
  "tests/agents-provider.test.ts",
  "tests/agentless-benchmark.test.ts",
  "tests/bundled-binary-spawn.test.ts",
  "tests/kiro-agent-manager-process.test.ts",
  "tests/kiro-agents-runtime.test.ts",
  "tests/kiro-detached-runtime.test.ts",
  "tests/kiro-dev-agent-process.test.ts",
  "tests/kiro-process-lifecycle.test.ts",
  "tests/kiro-worker.test.ts",
  "tests/localterm-transport.test.ts",
  "tests/mcp-provider.test.ts",
  "tests/node-process-runtime.test.ts",
  "tests/process-tree.test.ts",
  "tests/reliability-*.test.ts",
  "tests/residency*.test.ts",
  "tests/worker-e2e.test.ts",
] as const;
