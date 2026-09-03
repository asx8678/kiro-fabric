# Agent architecture and security audit

Kiro Fabric is one native custom-agent product. The selected agent owns one stdio MCP child; the child exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. Native Kiro tools remain outside QuickJS. The repository contains no discoverable `.kiro/agents/kiro-fabric.*`; only the user-global installed profile has that name. The execution, approval, workspace, persistence, cancellation, and package boundaries are covered by the files below and the full test suite. Power-named source paths, documented deprecated API aliases, explicit migration messages, and the `kiro-fabric-power-workspace-v3` salt remain only for compatibility; active descriptions and primary APIs are Agent/Fabric-first.

## Complete implementation inventory

- `scripts/agent-profile.mjs`
- `scripts/analyze-trace.mjs`
- `scripts/assert-build-artifacts.mjs`
- `scripts/assert-kiro-home-unchanged.mjs`
- `scripts/atomic-file.mjs`
- `scripts/build-agent-dev.mjs`
- `scripts/build-kiro-closure.mjs`
- `scripts/build.mjs`
- `scripts/certify-kiro-agent-real.mjs`
- `scripts/certify-kiro-agent.mjs`
- `scripts/create-agent-archive.mjs`
- `scripts/generate-agent-sbom.mjs`
- `scripts/install-agent-user.mjs`
- `scripts/package-identity.mjs`
- `scripts/package-policy.mjs`
- `scripts/real-client-evidence.mjs`
- `scripts/release-candidate-report.mjs`
- `scripts/run-agent-dev.mjs`
- `scripts/run-kiro-agent-real-driver.mjs`
- `scripts/validate-agent-package.mjs`
- `src/async-settlement.ts`
- `src/config.ts`
- `src/core/action-registry.ts`
- `src/execution-service.ts`
- `src/index.ts`
- `src/kernel/fabric-exec-contract.ts`
- `src/kernel/index.ts`
- `src/kiro/artifacts.ts`
- `src/kiro/canonical-path.ts`
- `src/kiro/deadlines.ts`
- `src/kiro/mcp-entry.ts`
- `src/kiro/mcp-provider.ts`
- `src/kiro/mcp-server.ts`
- `src/kiro/memory-provider.ts`
- `src/kiro/memory.ts`
- `src/kiro/power/agent-launch-context.ts`
- `src/kiro/power/approver.ts`
- `src/kiro/power/artifacts-provider.ts`
- `src/kiro/power/data-paths.ts`
- `src/kiro/power/workspace-binding.ts`
- `src/kiro/power/workspace-context.ts`
- `src/kiro/projection.ts`
- `src/kiro/runtime.ts`
- `src/protocol.ts`
- `src/providers/state-provider.ts`
- `src/runtime/compiler-worker-entry.ts`
- `src/runtime/deadline.ts`
- `src/runtime/guest-stack-map.ts`
- `src/runtime/guest-types.ts`
- `src/runtime/json-budget.ts`
- `src/runtime/quickjs-runtime.ts`
- `src/runtime/source-limit.ts`
- `src/runtime/type-checker.ts`
- `src/schema-validation.ts`
- `src/trace/trace-writer.ts`
- `src/trace/tracer.ts`
- `tests/action-registry.test.ts`
- `tests/agent-profile.test.ts`
- `tests/agent-user-install.test.ts`
- `tests/approval-projection.test.ts`
- `tests/archive.test.ts`
- `tests/artifacts-state.test.ts`
- `tests/compiler-isolation.test.ts`
- `tests/configuration.test.ts`
- `tests/deadline-policy.test.ts`
- `tests/fabric-exec-contract.test.ts`
- `tests/hermetic-stage.test.ts`
- `tests/json-budget.test.ts`
- `tests/mcp-federation.test.ts`
- `tests/memory-security.test.ts`
- `tests/mcp-process-lifecycle.test.ts`
- `tests/migration.test.ts`
- `tests/package-boundary.test.ts`
- `tests/quickjs-runtime.test.ts`
- `tests/release-evidence.test.ts`
- `tests/sbom-identity.test.ts`
- `tests/trace-analyze.test.ts`
- `tests/tracing.test.ts`
- `tests/workspace-binding.test.ts`

## Release qualification

Hermetic certification cannot claim authenticated-client behavior. `certify:agent:real` is designed to bind the extracted package digest, archive digest, Git commit, Kiro executable path/version/digest, exact argv, global profile, OS process observations, ACP recordings, Fabric traces, and per-phase transcripts. During the audit of starting SHA `5a95ec31edd2370619d472b8c775e14ad59d609e`, the installed Kiro 2.21.0 client selected and started the agent-owned MCP server but rejected the then-advertised `fabric_workspace` top-level union before model execution. The replacement non-combinator schema and complete lifecycle still require a fresh authenticated run on the exact final commit; agent selection, native-tool visibility, form elicitation, interactive compaction, shutdown, and resume remain blocked until that run produces objective evidence.
