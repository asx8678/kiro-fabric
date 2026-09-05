# Server follow-up

- Hoisted `fabric_exec` correlation/error projection around workspace synchronization so sync failures return normal adapter errors and emit one projection event.
- Kept workspace mutations cancellation-safe at the lifecycle commit boundary and verified the existing end-to-end MCP lifecycle/workspace suite.
- Added projection regressions for Unicode character/byte counts, failure diagnostics/log retention, and exact retention flags.
- Added execution-service regressions for successful/null/source/admission `resultValueChars` while preserving `resultChars`.
- Made catalog recovery hints caller-independent and retained the combined UTF-8 envelope bound.

Verification:

- `pnpm vitest run tests/approval-projection.test.ts tests/info-catalog.test.ts tests/execution-admission.test.ts`
- `pnpm vitest run tests/workspace-binding.test.ts tests/mcp-process-lifecycle.test.ts`
- `pnpm run typecheck`

The parent performs the final build after integrating all owned work.
