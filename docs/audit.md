# Agent architecture and security audit

> Historical pre-migration audit: native-routing observations below are retained as evidence, not active requirements. Current strict tool visibility and qualification are recorded in [strict-code-mode-migration.md](strict-code-mode-migration.md).

Kiro Fabric is one native custom-agent product. The selected agent owns one stdio MCP child; the child exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. Native Kiro tools remain outside QuickJS. The repository contains no discoverable `.kiro/agents/kiro-fabric.*`; only the user-global installed profile has that name. The execution, approval, workspace, persistence, cancellation, and package boundaries are covered by the files below and the full test suite. Power-named source paths, documented deprecated API aliases, explicit migration messages, and the `kiro-fabric-power-workspace-v3` salt remain only for compatibility; active descriptions and primary APIs are Agent/Fabric-first.

- `tests/installer-capability-fixture.ts` — native inode-anchored directory traversal probe for crash-recovery qualification.

## Workspace handoff and local effect scheduling coverage

- `tests/agent-launch-context.test.ts` — explicit workspace interpolation, missing handoff and unsafe-root validation.
- `tests/local-effect-queue.test.ts` — real Code Mode FIFO ordering, preparation after commit, parallel reads, failure/cancellation/deadline handling and cross-execution conflicts.

## Strict migration additions (current, not historical results)

- `src/kiro/bootstrap-provider.ts` — checked health/workspace access and bounded immutable bundled help.
- `src/providers/local-contract.ts` — host and guest coding contracts.
- `src/providers/local-path.ts` — verified-root path checks and content/identity snapshots; documented OS-race limits.
- `src/providers/local-provider.ts` — seven registry-backed coding actions and cross-process intent locks.
- `src/providers/local-shell.ts` — bounded approved host process execution and process-group cleanup.
- `tests/local-provider.test.ts` — local schemas, bounds, aliases, conflicts and approval snapshots.
- `tests/local-shell.test.ts` — real process exits, streams, cancellation/deadlines and descendant cleanup.
- `tests/strict-bootstrap.test.ts` — checked actual MCP bootstrap, local fixture coding and partial effects.
- `tests/schema-validation.test.ts` — distinguishes property names from restricted schema keywords without admitting regex/combinator execution.

## Compiled guidance and guarded benchmark additions

- `src/kiro/generated-guidance.ts` — immutable canonical skill/guide/recipe/workflow strings; no runtime file reads.
- `scripts/generate-agent-guidance.mjs` — bounded UTF-8 source validation and deterministic checked guidance generation.
- `tests/guidance.test.ts` — byte parity, closed help topics, paging/progress, cancellation, Unicode and public guest declarations.
- `scripts/steering-benchmark.mjs` — explicit opt-in live benchmark CLI; initialization/selftests do not invoke a model.
- `scripts/steering-benchmark/cases.mjs` — deterministic benign fixtures and explicit output/source contracts.
- `scripts/steering-benchmark/core.mjs` — bounded inventories, hashing and scope checks; no OS-sandbox claim.
- `scripts/steering-benchmark/oracles.mjs` — raw output, actual filesystem and execution evidence validation, with independent disposable Python probes.
- `scripts/steering-benchmark/plan.mjs` — paired schedules, immutable identities, live CLI settings and conservative spend admission.
- `scripts/steering-benchmark/runner.mjs` — exactly-once rows, retention of every failure/charge and stop-on-unknown behavior.
- `scripts/steering-benchmark/stream.mjs` — bounded process collection and strict ACP/usage accounting.
- `scripts/steering-benchmark/selftest.mjs` — explicitly synthetic offline oracle qualification, excluded from measured results.
- `tests/steering-benchmark.test.ts` — contract negatives, source/config drift, process bounds, interrupted rows and credit gates.

Benchmark scripts are development tooling, not installed model capabilities. The stopped live pilot and its limitations are recorded separately in the audits directory.

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
- `scripts/esbuild-common.mjs`
- `scripts/generate-agent-sbom.mjs`
- `scripts/install-agent-user.mjs`
- `scripts/package-identity.mjs`
- `scripts/package-policy.mjs`
- `scripts/real-client-evidence.mjs`
- `scripts/release-artifacts.mjs`
- `scripts/release-candidate-report.mjs`
- `scripts/run-agent-dev.mjs`
- `scripts/run-kiro-agent-real-driver.mjs`
- `scripts/validate-agent-package.mjs`
- `src/async-settlement.ts`
- `src/config.ts`
- `src/core/action-registry.ts`
- `src/core/semantic-digest.ts`
- `src/execution-service.ts`
- `src/index.ts`
- `src/kernel/fabric-exec-contract.ts`
- `src/kernel/index.ts`
- `src/kiro/artifacts.ts`
- `src/kiro/canonical-path.ts`
- `src/kiro/deadlines.ts`
- `src/kiro/info-catalog.ts`
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
- `tests/compiler-ownership.test.ts`
- `tests/configuration.test.ts`
- `tests/deadline-policy.test.ts`
- `tests/execution-admission.test.ts`
- `tests/fabric-exec-contract.test.ts`
- `tests/hermetic-stage.test.ts`
- `tests/info-catalog.test.ts`
- `tests/json-budget.test.ts`
- `tests/mcp-federation.test.ts`
- `tests/mcp-pagination.test.ts`
- `tests/memory-security.test.ts`
- `tests/memory-recovery.test.ts`
- `tests/memory-acknowledgement.test.ts`
- `tests/mcp-process-lifecycle.test.ts`
- `tests/migration.test.ts`
- `tests/package-boundary.test.ts`
- `tests/quickjs-runtime.test.ts`
- `tests/release-artifacts.test.ts`
- `tests/release-evidence.test.ts`
- `tests/sbom-identity.test.ts`
- `tests/server-efficiency.test.ts`
- `tests/storage-failure.test.ts`
- `tests/trace-analyze.test.ts`
- `tests/tracing.test.ts`
- `tests/workspace-binding.test.ts`

## Release qualification

Continuity evidence is fail-closed at the ACP boundary. The real-client evidence validator requires three ordered, non-overlapping manual `/compact` intervals, each with one direct command request, started/completed status sequence, successful matching response, unchanged MCP/runtime identity, and a subsequent exact Fabric sentinel check. It separately requires one naturally triggered automatic compaction after a unique bounded pressure prompt, with no manual command or tool call in that interval, followed by the same identity and sentinel checks. `chat.disableAutoCompaction` is read-only evidence and must show automatic compaction enabled; qualification never changes it. Every manual and automatic cycle receives a distinct cryptographically random fact in exactly one recorded pre-compaction user prompt. Each fact is prohibited from structural tool data before its compaction, absent from the post-compaction prompt, and required in that cycle's exact post-compaction call, normalized result, and durable state effect.

Hermetic subprocess coverage separately verifies that two MCP processes can concurrently share one workspace's durable memory and compare-and-set state without corruption. Another test kills an MCP process abruptly, starts a distinct process, restores the exact durable memory/state, and successfully extends it. These tests cover component storage behavior only, not authenticated Kiro selection, compaction, process reuse, or resume behavior.

Hermetic certification cannot claim authenticated-client behavior. `certify:agent:real` is designed to bind the extracted package digest, archive digest, Git commit, Kiro executable path/version/digest, exact argv, global profile, OS process observations, ACP recordings, Fabric traces, and per-phase transcripts. During the audit of starting SHA `5a95ec31edd2370619d472b8c775e14ad59d609e`, the installed Kiro 2.21.0 client selected and started the agent-owned MCP server but rejected the then-advertised `fabric_workspace` top-level union before model execution. The replacement non-combinator schema and complete lifecycle still require a fresh authenticated run on the exact final commit; agent selection, native-tool visibility, form elicitation, interactive compaction, shutdown, and resume remain blocked until that run produces objective evidence.

## Reliability repair follow-up (current inventory; not historical qualification)

This appended inventory records the later ownership, acknowledgement, prerequisite and diagnostics repairs. It does not change any historical audit result or claim authenticated release qualification. Baseline at `220f22abb55fbe898d6bbff37869b79830805667`: typecheck/build passed, 36 modules / 412 tests passed. Current verification is reported separately at handoff.

- `src/providers/local-executable.ts` — pinned trusted ripgrep prerequisite and clean search environment.
- `src/providers/owned-file.ts` — small exact-identity initialization and one-attempt descriptor-close primitive.
- `tests/installer-executable-trust.test.ts` — precise Node trust rejection matrix.
- `tests/release-workflow.test.ts` — actual shell tag comparison and platform prerequisite/coverage gates.
- `tests/agent-doctor.test.ts` — bounded read-only offline diagnostics and update-capacity separation.
- `tests/local-executable.test.ts` — missing, unsafe, replaced executables and environment isolation.
- `tests/local-lock-reliability.test.ts` — acquisition/release faults and foreign inode protection.
- `tests/local-diagnostics.test.ts` — shell head/tail, guest/projection diagnostics and local commit proof.
- `tests/local-search-work.test.ts` — large roots, eligible glob intersection, consumed-work bounds and timeout.
- `tests/state-reliability.test.ts` — exact ownership and common state commit acknowledgement.
- `tests/memory-delete-ack.test.ts` — committed delete proof through cleanup/cancellation/deadline.
- `tests/memory-lock-safety.test.ts` — unidentified/replacement/live/stale owner safety.
- `tests/owned-file.test.ts` — explicit uncertain close without unsafe descriptor retry.

## Complete-generation installer additions (current implementation)

- `scripts/build-complete-bundle.mjs`
- `scripts/build-private-tools.mjs`
- `scripts/bundle-archive.mjs`
- `scripts/bundle-contract.mjs`
- `scripts/generate-bundle-sbom.mjs`
- `scripts/generate-installer-bootstrap.mjs`
- `scripts/install-manager.mjs`
- `scripts/install-transaction.mjs`
- `scripts/installer-lock.mjs`
- `scripts/installer-platform.mjs`
- `scripts/installer-smoke.mjs`
- `scripts/managed-installation.mjs`
- `scripts/release-download.mjs`
- `scripts/release-trust.mjs`
- `scripts/source-install.mjs`
- `scripts/source-pull-hook.mjs` — explicit source-home post-merge activation with foreign-hook preservation.
- `tests/source-pull-hook.test.ts` — source-home equality, hook failure reporting, preservation, and narrow macOS ancestry policy.
- `src/installation/bundle-contract.mjs`
- `src/installation/installer-lock.mjs`
- `src/kiro/managed-generation.ts`
- `tests/bundle-archive.test.ts`
- `tests/bundle-contract.test.ts`
- `tests/bundle-fixture.ts`
- `tests/install-manager-cli.test.ts`
- `tests/installed-independence.test.ts`
- `tests/source-bootstrap.test.ts`
- `tests/legacy-archive.test.ts`
- `tests/install-transaction.test.ts`
- `tests/installer-bootstrap.test.ts`
- `tests/installer-home.test.ts`
- `tests/installer-lock.test.ts`
- `tests/installer-platform.test.ts`
- `tests/managed-generation.test.ts`
- `tests/managed-installation.test.ts`
- `tests/private-tools.test.ts`
- `tests/release-download.test.ts`
- `tests/release-fixture.ts`
- `tests/release-trust.test.ts`

## Verified audit remediation additions (current implementation)

These additions do not rewrite historical findings or establish authenticated client qualification or economic savings.

- `scripts/efficiency-baseline.mjs` — closed offline manifest/fixture/help probes with explicit measurement boundaries and null unobserved billing.
- `tests/efficiency-baseline.test.ts` — offline restrictions, provenance, failure retention and expanded-help accounting.
- `tests/approval-quotas.test.ts` — silent policy versus interactive quota accounting, unchanged provider/audit bounds, legacy compatibility and cancellation cleanup.
- `docs/efficiency-baseline.md` — reproducible offline procedure and separately authorized future paid comparison.

## Linux compatibility and efficiency follow-up (current implementation)

These entries extend the implementation inventory, not historical native or release qualification.

- `src/providers/local-process-group.ts` — bounded process-group evidence: live-leader fast path, streaming Linux proc inspection, deadlines and fail-closed visibility errors.
- `tests/local-process-group.test.ts` — simulated Linux process evidence, bounded concurrency/entry counts, malformed/unreadable observations and stalled-I/O deadlines.
- `tests/bundle-streaming.test.ts` — bounded hash buffers, exact inventory SHA-256 and concurrent grow/shrink/rewrite rejection.
- `tests/managed-generation-efficiency.test.ts` — one cryptographic Node capture per admission and invalidation on intervening identity/content changes.
- `docs/linux-validation.md` — reproducible native contract checks and explicit performance/security qualification limits.

## Agent comparison tooling (current implementation)

These entries extend the implementation inventory; observed statistics are descriptive, not release qualification.

- `scripts/steering-benchmark/projects.mjs` — dependency-free TinyShop bug catalog: eight seeded bug classes plus an all-bugs project, public reproductions, controller-held edge-case checks and bounded Node probes.
- `scripts/steering-benchmark/native-policy.mjs` — opt-in workspace-scoped native shell consent: exclusive per-workspace policy creation, identity recording and verified cleanup without touching global rules.
- `scripts/steering-benchmark/metrics.mjs` — coverage-aware statistics separating strict compliance, independent repair quality, latency and outer-call traffic; unknown telemetry stays null.
- `scripts/agent-comparison.mjs` — offline example export, oracle selftest and report generation; no inference in any command.
- `tests/agent-comparison.test.ts` / `tests/native-fixture-policy.test.ts` — fixture discrimination, held-out rejection, pairing, continuation selection, credit bounds and permission cleanup regression.
- `docs/agent-comparison.md` — runnable labs, checked-TypeScript Code Mode examples, live-plan consent and interpretation rules.
- `audits/agent-comparison-2026-09-09.md` — completed 54-attempt comparison record with full charge ledger.
