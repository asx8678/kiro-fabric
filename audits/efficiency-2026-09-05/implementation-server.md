# Server implementation

Implemented the server-owned efficiency and observability work:

- `fabric_info` retains its `actions` array and now includes sibling `catalog` metadata (`total`, `returned`, completeness, representation, digest completeness, and fixed targeted recovery hints). The combined actions/catalog envelope is bounded to 20,000 serialized UTF-8 bytes and degrades descriptors → refs/risk → a refs prefix.
- Workspace mutations re-check shutdown and request cancellation inside the serialized lifecycle closure immediately before commit.
- Execution projection reports content-free UTF-16/UTF-8 sizes and overflow/artifact-retention outcomes. The MCP adapter emits exactly this metadata as `exec.projection`, including early/admission/adapter errors, with an execution ID allocated before validation whenever tracing is enabled.
- `exec.end` retains legacy `resultChars` and adds `resultValueChars` (number on success, `null` otherwise), including service admission/source/typecheck failures.
- Fabric skill guidance uses only the actual memory call and explains catalog/digest incompleteness and targeted live recovery.

Validation performed by this worker:

```text
pnpm vitest run tests/info-catalog.test.ts tests/approval-projection.test.ts tests/tracing.test.ts tests/fabric-exec-contract.test.ts
4 files passed, 34 tests passed

pnpm run typecheck
passed
```

The parent orchestrator owns the final build/staging/full validation. No live Kiro or billing claim is made. Pre-existing audit artifacts and files owned by other workers were left intact.
