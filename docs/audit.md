# Implementation and validation inventory

This inventory is checked by the package-boundary tests. Current runtime contracts are documented in [configuration.md](configuration.md), and qualification requirements are in [release.md](release.md). Historical audit reports and completed implementation plans remain in Git history; keep new local reports and probes under the ignored `.tmp/` directory.

Kiro Fabric is one native custom-agent product. The selected agent owns one stdio MCP child; the child exposes exactly `fabric_info`, `fabric_workspace`, and `fabric_exec`. Native Kiro tools remain outside QuickJS. The repository contains no discoverable `.kiro/agents/kiro-fabric.*`; only the user-global installed profile has that name. The execution, approval, workspace, persistence, cancellation, and package boundaries are covered by the files below and the full test suite. Power-named source paths, documented deprecated API aliases, explicit migration messages, and the `kiro-fabric-power-workspace-v3` salt remain only for compatibility; active descriptions and primary APIs are Agent/Fabric-first.

- `tests/installer-capability-fixture.ts` — native inode-anchored directory traversal probe for crash-recovery qualification.

- `tests/remediation-regressions.test.ts` — fail-closed approval diagnostics, unknown benchmark spend, and TinyShop agent execution-audit regressions.

## Canonical observed tool discovery and continuation

- `src/bounded-search.ts` — shared integer search for fitting page envelopes; callers retain EOF, Unicode and progress checks.
- `tests/bounded-search.test.ts` — threshold, nonzero-offset, empty-range and predicate-failure coverage.
- `src/core/remote-identity.ts` — exact RFC3986 canonical remote identity and strict decode-once validation.
- `src/core/catalog-contract.ts` — separate typed paging contracts and non-serializable host result provenance.
- `src/core/catalog-execution.ts` — exclusive-selector validation, metadata-only continuation and actionable legacy paging recovery.
- `src/core/catalog-resources.ts` — conservative retained JSON/container accounting.
- `src/core/catalog-snapshot-store.ts` — runtime/client/workspace-bound HMAC cursors, local provider-epoch dependencies on reservations and snapshots, exact descriptor chunks, quotas and finite lifecycle.
- `tests/discovery-index.test.ts` — deterministic warm-work counters, revision churn/coalescing, dynamic parity, defensive metadata, cancellation and aggregate cached/dynamic/in-flight admission.
- `tests/discovery-retention.test.ts` — pre-launch raw reservations, failed-index WeakRef reachability, 25,000 detached cancellation subscribers and trusted QuickJS quota failures.
- `tests/mcp-observed-discovery.test.ts` — fake-runtime approved observations, collision routing, selected projection and invalidation.
- `tests/catalog-snapshot-store.test.ts` — envelope budgets, tamper/expiry/renewal/LRU, graph safety and permanent revocation.
- `tests/catalog-integration.test.ts` — checked QuickJS plus actual in-memory SDK, 1000-tool cross-execution reconstruction, legacy recovery, saved-cursor revocation without replay and pending approval/discovery races.
- `tests/catalog-provider-revocation.test.ts` — selected-server and global inventory epochs, fresh reopening and late-publication rejection with fake transports.
- `tests/catalog-lifecycle.test.ts` — actual outer-host cursor ownership and workspace/unavailable/close revocation before deferred execution cleanup.

The five friendly page methods do not expand outer tools. MCP calls always re-enumerate current authoritative schemas before dispatch; observed metadata and continuations never grant execution permission. Discovery retention uses conservative partitions within 64MiB/1M nodes rather than sharing an unbounded general artifact store. Known provider revocation is checked synchronously on every cursor read and publication; it never triggers network revalidation or replay. Revoked snapshot memory is pruned on the next store operation, remains within the fixed store quotas meanwhile, and is cleared on runtime invalidation. Successful discovery binds its new page to the resulting inventory epoch rather than the pre-discovery epoch. Index producers reserve a 7MiB/100,000-node raw handoff before provider list/describe, with at most two producers; additional loads wait only for reserved capacity and reject if pinned indexes prevent progress. Raw validation limits serialization to one quarter of that byte allowance before accepting its measured weight. Consumer subscriptions detach on failure/cancellation; uncooperative active producers remain charged until settlement. The bounds cover host-owned discovery retention, not arbitrary allocation inside trusted provider implementations or caller-owned returned values. Tests and builds are not live-client approval qualification.

## Deterministic continuity and behavior-preserving optimization

Continuity remains explicit and opt-in: declared checks and historical host receipts are not semantic proof, automatic conversation recovery, or native compaction. Rendering measures each original record once and uses incremental UTF-8/escaped-JSON budgets; output ordering, omissions and exact-fit boundaries remain compatible. Limited discovery uses bounded top-k selection with the existing score/ref ordering; full discovery and safety quotas are unchanged.

- `src/continuity/execution.ts` — execution-local admission, settlement and closed-prefix observations.
- `src/continuity/records.ts` — strict versioned records, normalized identities, hashes and quotas.
- `src/continuity/store.ts` — private durable checkpoints, CAS and idempotent publication.
- `src/continuity/render.ts` — version-compatible declaration/receipt projection.
- `src/continuity/task-view.ts` — check assessment and priority-based task views.
- `src/continuity/summary-budget.ts` — reusable line weights and exact incremental summary/envelope budgets.
- `src/continuity/recall.ts` — bounded, source-bound search and expansion pointers.
- `src/providers/continuity-contract.ts` — closed action schemas and checked guest declarations.
- `src/providers/continuity-provider.ts` — explicit recovery operations and source freshness checks.
- `src/core/ranked-actions.ts` — bounded worst-first heap for limited discovery results.
- `tests/continuity-core.test.ts` — normalization, reproducible output and record rejection.
- `tests/continuity-store.test.ts` — durable publication, revision conflicts and quotas.
- `tests/continuity-provider.test.ts` — provider contracts and registration.
- `tests/continuity-execution.test.ts` — checked execution and recovery boundaries.
- `tests/continuity-capture.test.ts` — closed-prefix capture and publication semantics.
- `tests/continuity-observation.test.ts` — host observation and failure boundaries.
- `tests/continuity-task.test.ts` — linked evidence, freshness, recall and cold recovery.
- `tests/continuity-rendering.test.ts` — pre-optimization output/error fingerprints, exact byte boundaries and serialization work bounds.
- `tests/fixtures/continuity-rendering.ts` — deterministic mixed-version rendering fixtures and budget matrices.
- `tests/execution-refactor.test.ts` — shared per-execution approval budgets, failed-prompt cleanup and reset.
- `tests/installed-bundle-history.test.ts` — installed bundle/history compatibility.

The execution approval controller and qualification/validation phase helpers remain private; public APIs, approval ordering and qualification gates are retained.

## Browser-backed fact grounding

- `src/providers/web-provider.ts` — opt-in trusted CLI discovery, bounded execution, closed contracts, explicit Google/Bing selection with matching discovery/effects/output, fixed CAPTCHA/consent/redirect categories and withheld raw diagnostics.
- `src/providers/web-privacy.ts` — bounded heuristic secret/PII and token-URL rejection before dispatch; not semantic DLP.
- `src/providers/web-snippets.ts` — fixed JSON-escaped CDP recipes, per-call private contexts, bounded deadline cleanup, Google/Bing extraction, decoded destination links and bounded page text. Confirmed CDP context disposal closes its pages even if concurrent tab closure rejects; unconfirmed context disposal still fails.
- `tests/web-provider.test.ts` — executable trust, process bounds, configuration, checked guest/runtime registration and denied-before-launch controls.
- `tests/web-snippets.test.ts` — actual generated JS with deterministic CDP/DOM fixtures, isolated parallel tabs, error paths and late-creation cleanup.

## Review reliability and explicit profiles

These additions preserve Code Mode and ordinary approvals. Structural evidence accounting is not semantic validation or proof of live-agent superiority.

- `src/providers/review-contract.ts` — host/guest typed optional task, coverage, causal/failure obligations and finding contracts.
- `src/providers/review-provider.ts` — bounded instance-local ledger, host-read hash evidence, structural admission, advisory reconciliation and expiry.
- `src/providers/local-evidence.ts` — full source packets with framed metadata and continuations, budgeted after serialization.
- `src/providers/probe-contract.ts` — closed schemas and typed retained-probe operations.
- `src/providers/probe-provider.ts` — explicit approved creation, file writes, execution, retention and ordinary-exit diagnostics.
- `src/providers/probe-storage.ts` — canonical owned storage and create-only identity-checked publication outside source.
- `src/providers/probe-discovery.ts` — bounded SDK/executable/cache presence checks without version execution or credential assumptions.
- `src/kiro/run-provenance.ts` — bounded hashed configured-versus-observed metadata; unknown routing remains unknown.
- `scripts/launch-profile.mjs` — explicit generation-specific review/minimal launch profiles without replacing the managed default.
- `scripts/steering-benchmark/run-provenance.mjs` — explicit-file manifest/compare CLI and independently classified delivery evidence.
- `scripts/steering-benchmark/review-regressions.mjs` — seeded/held-out cross-file and framework-contract fixtures, private structural oracles and offline qualification.
- `tests/review-ledger.test.ts` — task isolation, structural admission, stale source, quotas, expiry, authority and guest declarations.
- `tests/local-evidence.test.ts` — compact packets, Unicode/escaping, continuations, failures and source safety.
- `tests/probe-provider.test.ts` — denied effects, actual process exits, retention, discovery, quotas, identity and cancellation.
- `tests/review-profile.test.ts` — explicit mode selection, no hidden minimal resources/hooks and real typed recipes.
- `tests/run-provenance.test.ts` — unknown/declared/observed separation, bounds, hashing and explicit CLI capture.
- `tests/launch-profile.test.ts` — default preservation, opt-in generation profiles and collision/symlink refusal.
- `tests/review-runtime-integration.test.ts` — public namespaces through actual checked execution, stale evidence, approvals, failure diagnostics and FIFO protection.
- `tests/review-regressions.test.ts` — independently executable positive/negative controls and finite-oracle calibration.
- `tests/review-regressions-integration.test.ts` — case registration, matched repeated scheduling, scenario admission and quality-first reporting.

## Workspace handoff and local effect scheduling coverage

- `tests/agent-launch-context.test.ts` — explicit workspace interpolation, missing handoff and unsafe-root validation.
- `tests/local-effect-queue.test.ts` — real Code Mode FIFO ordering, preparation after commit, parallel reads, failure/cancellation/deadline handling and cross-execution conflicts.

## Strict migration additions (current, not historical results)

- `src/kiro/bootstrap-provider.ts` — checked health/workspace access and bounded immutable bundled help.
- `src/providers/local-contract.ts` — host and guest coding contracts.
- `src/providers/local-path.ts` — verified-root path checks and content/identity snapshots; documented OS-race limits.
- `src/providers/local-provider.ts` — registry-backed coding actions and cross-process intent locks.
- `src/providers/local-read-many.ts` — numbered source batches with bounded, hash-checked continuations.
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

Benchmark scripts are development tooling, not installed model capabilities. Their reproducible workflow and measurement limits are documented in [agent-comparison.md](agent-comparison.md).

## Complete implementation inventory

- `src/kiro/first-prompt-guidance.ts` — full-scope problem solving, evidence, falsification, persistence and verified completion ahead of token/credit savings; no reporting word target or unsupported Auto-routing guarantee. The checked discovery/read example is task-loaded from `skills/fabric-exec/references/review.md`.
- `src/kiro/first-prompt-hook.ts` — per-session, at-most-once prompt context through the profile's submit hook; private markers contain no prompt text.
- `tests/first-prompt.test.ts` — separate/concurrent/resumed sessions, actual built hook processes, literal arguments, private state boundaries and executable starter coverage, source budgets, continuations and partial failures.
- `scripts/agent-profile.mjs`
- `scripts/analyze-trace.mjs`
- `scripts/assert-build-artifacts.mjs`
- `scripts/normalize-artifact-modes.mjs` — removes group/other write bits from build outputs without widening private modes; rejects links and special files.
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
- `scripts/packed-runtime-imports.mjs` — AST-based exact packed ESM inventory checks, excluding comments/string contents.
- `tests/packed-runtime-imports.test.ts` — Git-marker false-positive regression and missing static/export/dynamic-literal dependency rejection.
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
- `src/runtime/sandbox-worker-entry.ts`
- `src/runtime/deadline.ts`
- `src/runtime/guest-bootstrap.ts` — frozen guest bootstrap source: captured primordials, disabled dynamic code generation, and bounded bridge facades.
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
- `tests/action-registry-lifecycle.test.ts` — terminal closure guards at admission, dequeue, and each dispatch boundary; queued and in-flight calls reject as closed without provider contact.
- `tests/agent-profile.test.ts`
- `tests/agent-user-install.test.ts`
- `tests/approval-projection.test.ts`
- `tests/archive.test.ts`
- `tests/artifact-startup-recovery.test.ts` — shared artifact-root startup tolerates exact concurrent disappearance of residue entries while foreign entries and other failures still reject.
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
- `tests/qualification-driver-capture.test.ts` — offline pressure collector binds compaction success at any bounded attempt to the whole seed-adjacent interval and rejects intervening tools/manual compacts.
- `tests/quickjs-runtime.test.ts`
- `tests/quickjs-worker-lifecycle.test.ts` — extended watchdog rescheduling anchored at the fixed deadline, hard-max capping, host-call cancellation and bounded drain on worker fault/close, and stale cross-execution message rejection.
- `tests/quickjs-worker-protocol.test.ts` — per-execution message IDs; stale replies, aborts, expiry and floors cannot target a reused pooled slot; duplicate run messages are ignored.
- `tests/state-boundary-regressions.test.ts` — state-root identity/privacy revalidation on every operation; versioned stale-lock recovery with exclusive per-token claims, real SIGKILL two-reclaimer arbitration, and fail-closed preservation of legacy/interrupted evidence.
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
- `tests/memory-quota.test.ts` — bounded namespace enumeration, cumulative byte enforcement, and quota parity across list/search/index.
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
- `scripts/installer-configuration-backup.mjs` — pre-mutation Kiro configuration backup with hash-verified, containment-checked restore.
- `scripts/installer-home-preparation.mjs` — read-only directory/profile preflight, inode-checked private permissions, and explicit checksum-verified Pi Fabric profile preservation under the installation lock.
- `scripts/installer-shell-integration.mjs` — backed-up bash/zsh workspace handoff, explicit opt-out, owned-block updates/removal, and interrupted-operation recovery without inferring backend cwd.
- `scripts/installer-lock.mjs`
- `scripts/installer-platform.mjs`
- `scripts/installer-smoke.mjs`
- `scripts/managed-installation.mjs`
- `scripts/release-download.mjs`
- `scripts/release-trust.mjs`
- `scripts/source-install.mjs`
- `scripts/source-pull-hook.mjs` — explicit source-home post-merge activation with foreign-hook preservation.
- `tests/source-pull-hook.test.ts` — source-home equality, hook failure reporting, preservation, and narrow macOS ancestry policy.
- `tests/fixture-cleanup.mjs` — explicit bounded test teardown; retains whole fixtures containing Git metadata or bare repository layouts and refuses uninspectable/unsafe roots. Read-only inspection is independent of production fault mocks; no production filesystem monkey-patch or later repository pruning.
- `tests/fixture-cleanup.test.ts` — nested/worktree/symlink/case-folded metadata, real git-init retention without commits, bare layouts, direct metadata paths, unsafe roots, bounded traversal, inspection failures, mock independence, non-repository removal and an AST guard against raw test fs removals.
- `tests/installer-configuration-backup.test.ts` — backup manifest, retention, skip and fail-closed restore coverage.
- `src/installation/bundle-contract.mjs`
- `src/installation/installer-lock.mjs`
- `src/installation/pinned-recovery.mjs` — embedded bounded child for macOS inode-pinned claim inspection, exclusive empty creation and exact publication; no parent cwd mutation or pathname recovery fallback.
- `src/installation/pinned-directory-child.mjs` — src-side mirror of `scripts/pinned-directory-child.mjs`; fixed allowlisted single-component operations under a caller-held parent descriptor (Linux `/proc/self/fd` alias or verified child), used by `src/providers/state-provider.ts` for anchored lock/claim deletion after root rename detection.
- `src/kiro/managed-generation.ts`
- `tests/bundle-archive.test.ts`
- `tests/bundle-contract.test.ts`
- `tests/bundle-fixture.ts`
- `tests/install-manager-cli.test.ts`
- `tests/install-manager-start.test.ts` — read-only active-generation launch admission, prerequisite/recovery/integrity exit codes, legacy refusal, and workspace/child-exit preservation.
- `tests/installed-independence.test.ts`
- `tests/source-bootstrap.test.ts`
- `tests/legacy-archive.test.ts`
- `tests/install-transaction.test.ts`
- `tests/installer-bootstrap.test.ts`
- `tests/installer-home.test.ts`
- `tests/installer-home-preparation.test.ts` — private directory preparation, legacy ownership verification, durable profile preservation, activation, and conflict/lock refusal coverage.
- `tests/installer-shell-integration.test.ts` — fresh-terminal bash/zsh execution, per-project handoff, argv/exit preservation, shell conflicts, backups, and uninstall/crash recovery.
- `tests/installer-lock.test.ts`
- `tests/pinned-recovery.test.ts` — real child cwd pinning under pathname replacement, claim/control identity checks, canonical bounds and Node environment isolation.
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
- `scripts/steering-benchmark/task-behavior.mjs` — opt-in single-turn plan, review-only, exact scoped repair, deep-ledger and read-only diagnosis fixtures; finite proposition/source-evidence grading, not proof of model reasoning, complete read coverage or credit savings.
- `scripts/steering-benchmark/native-policy.mjs` — opt-in workspace-scoped native shell consent: exclusive per-workspace policy creation, identity recording and verified cleanup without touching global rules.
- `scripts/steering-benchmark/metrics.mjs` — coverage-aware statistics separating strict compliance, independent repair quality, latency and outer-call traffic; unknown telemetry stays null.
- `scripts/agent-comparison.mjs` — offline example export, oracle selftest and report generation; no inference in any command.
- `tests/agent-comparison.test.ts` / `tests/native-fixture-policy.test.ts` — fixture discrimination, held-out rejection, pairing, continuation selection, credit bounds and permission cleanup regression.
- `docs/agent-comparison.md` — runnable labs, checked-TypeScript Code Mode examples, live-plan consent and interpretation rules.

## Review adherence additions (current implementation)

- `scripts/steering-benchmark/review-quality.mjs` — opt-in finite claim/proof/confidence/coverage oracle; manual semantic adjudication remains required.
- `scripts/steering-benchmark/review-delivery.mjs` — bounded matching of observed structured help pages against a frozen arm reference, not inferred invocation or comprehension.
- `tests/review-quality.test.ts` — contradiction, unsupported consequence, confidence, citation coverage, recall and failure-aware metric regressions.
- `tests/review-delivery.test.ts` — full/partial/missing/forged help-output evidence and UTF-16 continuity.

## Round-trip recovery additions (current implementation)

These entries record implementation coverage, not measured live speedups or authenticated client qualification.

- `src/core/repair-error.ts` — bounded trusted structural repair metadata and typed compiler timeout classification.
- `src/providers/local-edit.ts` — original-snapshot disjoint replacements validated before one approval/publication.
- `scripts/build-inputs.mjs` — deterministic build-input provenance, independent closure validation and capture drift checks.
- `tests/structured-recovery.test.ts` — checked guest hints, dispatch uncertainty, timeout phases and checkpoint isolation.
- `tests/artifact-recovery.test.ts` — typed escaped-envelope paging, canonical retention and approved ephemeral checkpoint privacy/quotas.
- `tests/local-code-mode-fixes.test.ts` — atomic edit/hash guards, partial read failures and invocation snapshot reuse.
- `tests/local-search-cursor.test.ts` — opaque single-use TTL cursors, bounded cache and enumeration/content drift checks.
- `tests/build-input-provenance.test.ts` — stale source/guidance rejection and captured resource integrity.
- `tests/artifact-modes.test.ts` — exact permission-bit removal, idempotence, build ordering and link-target preservation.
- `tests/roundtrip-recipes.test.ts` — composed bounded discovery/read/probe examples and diagnostic-to-source chains.

## Code-mode efficiency and calibration additions (current implementation)

These entries record implementation and regression coverage, not live-model quality or billing gains.

- `src/providers/local-line-index.ts` — invocation-local UTF-16 line ends for bounded, whole-line source windows.
- `tests/local-line-index.test.ts` — CRLF/BOM/EOF equivalence, index reuse, escaped budgets and retained snapshot drift detection.
- `tests/result-budget.test.ts` — Unicode/escape-aware truncation envelopes and checked execution without provider replay.
- `tests/mcp-projection.test.ts` — opt-in full/text/structured views, canonical approval, unchanged remote arguments/errors and pre-bridge projection.
- `tests/local-query-pagination.test.ts` — explicit query-v1 scope, reduced selective-query I/O, membership/content/ignore drift, unsafe files, bounded independent pages and cursor lifecycle.
- `tests/compiler-cache.test.ts` / `tests/code-mode-cache.test.ts` — bounded compiler-output reuse and fresh policy/payload/provider/guest execution.
- `tests/projection-noise.test.ts` / `tests/agent-profile.test.ts` — diagnostic hint deduplication and profile/prompt-size contracts.
- `scripts/steering-benchmark/review-calibration.mjs` — finite controller-owned consequence, severity and recommendation calibration with independent inert probes.
- `tests/review-calibration.test.ts` / `tests/review-calibration-integration.test.ts` — fixture mutation, grounding, calibrated admission, private oracle hashes and failure-aware comparison metrics.
- `tests/review-runtime-controls.test.ts` — optional offline Helm/PowerShell qualification; missing binaries remain explicit skips.

## Review coverage improvements (current implementation)

These entries document later changes, not a revision to historical results or evidence of live model superiority.

- `scripts/steering-benchmark/reviews.mjs` — seeded read-only infrastructure, cleanup and boundary fixtures; source-line/caller-consumer grading; independent Node/Bash qualification of defects and false-positive controls.
- `tests/review-benchmark.test.ts` — recall/precision, duplicate/forged evidence rejection, read-only scope, failure-inclusive cost and equal-model/effort regression.
- `tests/local-review-coverage.test.ts` — hidden CI discovery, ignore/VCS/alias safeguards, bounded scope metadata and whole-file line/continuation checks.
- `tests/local-search-read.test.ts` — deterministic guest search→read composition: deduplicated match paths, merged and capped context windows with explicit continuation, zero-match short-circuit, and explicit requested-range/scope-exhaustion reporting.
- `tests/review-execution.test.ts` — real compiler/guest execution of dictionary repairs, no effects on validation failure, visible diagnostic hints and numbered source with range/EOF metadata.
- `tests/local-read-many.test.ts` — aggregate source budgets, complete continuations, changed-file rejection and unsafe-path controls.
- `tests/source-packets.test.ts` — checked runtime and visible projection of related source batches, complete evidence with fewer calls, and nested/visible budget clamps.
- `skills/fabric-exec/references/review.md` — task-loaded coverage ledger, risk-prioritized reference tracing, falsification and explicit partial-review reporting.
- Existing local read/search contracts add total line counts and search scope; all-files manifests avoid a redundant ripgrep launch. Permission and execution budgets are unchanged.

## Installer reliability implementation follow-up

This is implementation/regression inventory, not native or authenticated release qualification. Production trust and publication remain blocked. Source activation keeps Code Mode and installed-home isolation; no installer command becomes an unrestricted native-tool bypass.

Backup coverage distinguishes source artifacts from configuration, preserves excluded trees and rejects unsafe nested links. Retained-target rollback restores hash-bound original profiles (including real historical factory/inspector data); offline recovery preserves ambiguous evidence. CLI metadata drives help/validation/partial previews and truthful postcommit errors. Independent smoke checks validate actual read/search receipts, not echoed sentinels. Source packaging reuses verified immutable artifacts under leases, streams archives/private staging, and provides conservative opt-in checkout GC. Fixed descriptor-bound operations use a validated inherited-fd child where directory aliases are unavailable.

New implementation files:
- `src/installation/filesystem-boundary.mjs`
- `scripts/filesystem-boundary.mjs`
- `scripts/installer-artifacts.mjs`
- `scripts/installer-cache.mjs`
- `scripts/installer-ci-cache.mjs`
- `scripts/installer-cli-contract.mjs`
- `scripts/installer-diagnostics.mjs`
- `scripts/installer-probe.mjs` — read-only help/version probes with one timeout-only retry and unchanged per-attempt limits.
- `scripts/installer-profile-publication.mjs`
- `scripts/installer-profile-store.mjs`
- `scripts/installer-smoke-contract.mjs`
- `scripts/pinned-directory-child.mjs`
- `scripts/private-extraction.mjs`
- `scripts/qualification-failure.mjs`
- `scripts/source-bundle-stage.mjs`
- `scripts/test-installer.mjs`

Regression and acceptance files:
- `tests/installer-archive-stream.test.ts`
- `tests/installer-boundary-regressions.test.ts`
- `tests/installer-cache.test.ts`
- `tests/installer-ci-cache-acceptance.test.ts`
- `tests/installer-cli-contract.test.ts`
- `tests/installer-diagnostics.test.ts`
- `tests/installer-extraction-portability.test.ts`
- `tests/installer-manager-acceptance.test.ts`
- `tests/installer-native-zsh-acceptance.test.ts`
- `tests/installer-packaging-cache.test.ts`
- `tests/installer-presentation.test.ts` — version/backup presentation, cancellation without mutation, and single-envelope JSON output.
- `tests/installer-probe.test.ts` — identical-argument timeout retry, bounded attempts and no retry for other failures.
- `tests/installer-profile-publication.test.ts`
- `tests/installer-smoke-acceptance.test.ts`
- `tests/installer-smoke-bundle-acceptance.test.ts`
- `tests/installer-suite-registration.test.ts`
- `tests/managed-installation-lifecycle.test.ts`
- `tests/qualification-failure-acceptance.test.ts`
- `tests/release-capture-boundaries.test.ts`
- `tests/source-bundle-stage.test.ts`
- `tests/source-frontend-acceptance.test.ts`
- `tests/source-installer-contract.test.ts`
- `tests/bundle-sbom-artifacts.test.ts`

Historical module bytes in `tests/fixtures/installer-history/c0f65e9/agent-profile.mjs.txt`, `tests/fixtures/installer-history/c0f65e9/managed-installation.mjs.txt` and `tests/fixtures/installer-history/d33de003/install-agent-user.mjs.txt` are hash-pinned test data, so shallow/offline checkouts need no historical Git subprocess. The native suite registry is shared with CI; passing Linux child-strategy tests does not claim native macOS qualification. SBOM producers retain legacy names and emit archive-linked snapshots with exact size/hash descriptors; no signing key or qualification bypass is introduced. Failure publications are sanitized and nonqualifying; transcript-bound private success evidence is not silently stripped and published as proof.

Lock-release crash coverage: `tests/installer-lock-release.test.ts` reproduces SIGKILL between owner unlink and directory removal, then verifies durable release-marker recovery, positive birth identity, preserved foreign evidence and retained committed transaction provenance. `src/installation/installer-lock.mjs` and `src/installation/pinned-recovery.mjs` keep public lock APIs unchanged. Legacy ownerless locks without proof remain preserved; this is not an age-based force-clean mechanism.

## Native Fovea implementation and acceptance

- `scripts/fovea-capability-probe.mjs` — native integration, managed distribution or isolated qualification support.
- `scripts/fovea-reference-harness.mjs` — native integration, managed distribution or isolated qualification support.
- `scripts/fovea-lifecycle-harness.mjs` — development-only exact-archive lifecycle replay with pinned parser, private reports and bounded subprocesses; no native qualification claim.
- `tests/fovea/fixtures/lifecycle-driver.mjs` — real pinned Fovea extension and Pi Fabric capture pipeline driven by explicitly synthetic runner/read/write/edit tools, not Pi/Kiro UI.
- `tests/fovea/reference-lifecycle.test.ts` — reference lifecycle/mutation/provenance assertions and actual native publication/delivery comparisons; visible skip when pinned Git objects are unavailable.
- `scripts/generate-vendored-sbom.mjs` — native integration, managed distribution or isolated qualification support.
- `src/fovea/config.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/core/anchors.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/astgrep.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/asyncutil.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/basins.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/bend.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/build.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/cochange.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/context.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/discover.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/extract.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/git.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/graph.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/heat.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/join.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/ops.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/protocols.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/provenance.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/render.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/result-budget.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/session.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/source.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/state.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/sync.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/temp-storage.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/core/types.ts` — pinned upstream-derived deterministic analysis API.
- `src/fovea/delivery.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/engine-entry.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/engine-process.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/engine.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/git-executable.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/host.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/observations.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/parser-executable.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/protocol.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/provenance-journal.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/result-store.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/root-leases.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/scheduler.ts` — native integration, managed distribution or isolated qualification support.
- `src/fovea/source-access.ts` — bounded SHA-256 snapshot policy over descriptor capabilities; no source-path reopen.
- `src/fovea/source-platform.ts` — Linux descriptor-relative operations, complete bounded reads, closed platform selection and canonical root traversal.
- `src/fovea/source-platform-darwin.ts` — trusted Darwin ABI adapter contract; no `/dev/fd` or PATH fallback.
- `src/fovea/source-platform-native.ts` — opaque capability bridge for a trusted POSIX binding; binary admission remains separate, with no guest-selected path.
- `src/fovea/source-platform-native.c` — N-API openat/fdopendir implementation, compiled for managed Darwin source access and native POSIX fixtures.
- `src/fovea/native-source-loader.ts` — complete-generation, Node/parser, source-hash and Mach-O identity checks before loading captured native bytes from private engine storage.
- `scripts/build-fovea-native.mjs` — build-time local compilation and source-bound native artifact metadata; no runtime compilation or downloads.
- `tests/fovea/native-source-loader.test.ts` — native artifact identity, generation admission and build/loader regression coverage.
- `tests/fovea/git-executable.test.ts` — fixed trusted Darwin/Linux Git selection and executable/ancestry rejection coverage.
- `tests/fovea/source-platform-native.test.ts` — compiled native POSIX capture, descriptor ownership, no-follow, resource bounds and cleanup probes on the actual host; this is not automatic native-client qualification.
- `tests/fovea/source-platform.test.ts` — descriptor-relative capture and platform contract/race probes.
- `tests/fovea/source-platform-bounds.test.ts` — shared enumeration/read budgets, short reads, mutation checks and cleanup.
- `tests/fovea/production-batching.test.ts` — ordered bounded source publication, real batched parser repeatability and cache-header invalidation.
- `tests/fovea/historical-manager-migration.test.ts` — exact archived schema-1 manager, schema-2 handoff, retained runtime coexistence, rollback and interrupted-activation recovery.
- `src/kiro/fovea-hook.ts` — native integration, managed distribution or isolated qualification support.
- `src/providers/repo-contract.ts` — native integration, managed distribution or isolated qualification support.
- `src/providers/repo-provider.ts` — native integration, managed distribution or isolated qualification support.
- `tests/fovea/capability.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/config-project.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/core-basins.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/core-conserved-heat.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/core-heat.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/engine-languages.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/engine-review.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/engine.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/guest-focus-read.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/guest-grep.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/host-boundaries.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/host-process.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/observations.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/packaging.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `tests/fovea/reference-differential.test.ts` — warm-fact operation compatibility, cold-core exact-parser/FIFO-input replay, and separate unqualified independent-cold repeatability probe; see Fovea parity ledger.
- `tests/fovea/cold-inputs.test.ts` — fail-closed parser tape identity, exact output/error bytes, quota/corruption/unconsumed-request guards and source-read scheduling recovery.
- `tests/fovea/fixtures/cold-inputs.mjs` — development-only generated subprocess entry; FIFO source-read dependency adapter and exact parser tape. Not shipped or a production determinism claim.
- `tests/fovea/reference.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `scripts/qualify-fovea-references.mjs` — opt-in exact-pinned prerequisite admission and full lifecycle/differential execution; rejects unexplained skips and preserves the full-suite report.
- `tests/fovea/reference-qualification.test.ts` — missing pins, missing modules, failures and unexpected skips cannot grant qualification.

## Native Fovea implementation and acceptance

- `scripts/installer-directory-identity.mjs` — APFS volume-UUID and inode binding across device renumbering; legacy mismatch remains recovery-required, never automatically reanchored.
- `tests/installer-directory-identity.test.ts` — stable-volume matching, adversarial identity refusal and historical snapshot/transaction evidence preservation.
- `src/kiro/fovea-native.ts` — shared fail-closed native capability diagnostics; MCP ownership is not native chat identity.
- `scripts/fovea-native-probe.mjs` — explicit authenticated scratch-profile TUI/headless contract probe, not Fabric execution or qualification.
- `tests/fovea/native-probe.test.ts` — protocol evidence summarization and exact native hook shape/matcher regression.
- `tests/fovea/native-status.test.ts` — quiet default hook and explicit status behavior; no fabricated context delivery.
- `tests/fovea/provenance-native.test.ts` — compiled descriptor-relative journal CAS, cross-session publication, revocation and adversarial failure coverage.
- `tests/fovea/fixtures/native-lifecycle-platform.ts` — Darwin component lifecycle native-binding fixture; generation admission alone is substituted, not engine/IPC/provenance behavior.
- `tests/fovea/qualification-records.test.ts` — current qualification/parity agreement and separation from historical isolated authentication/platform evidence.
- `tests/fovea/provenance.test.ts` — executable component/behavior qualification; see Fovea parity ledger.
- `src/kiro/fovea-context.ts` — bounded host-owned post-settlement collection and transport emission ledger; activation requires a trusted qualified capability.
- `tests/fovea/context-delivery.test.ts` — replay, budget, cancellation, revocation, and emission-not-acknowledgment regressions.
- `tests/fovea/coverage-contract.test.ts` — real engine coverage packet/schema and guest typing checks.
- `tests/fovea/mcp-context.test.ts` — real built MCP collector/default-off integration; not native-client evidence.
- `scripts/fovea-human-qualification.mjs` — six genuine terminal cases, private checkpoints, replay/drift rejection and stop-on-block; no automated responses or native gate promotion.
- `tests/fovea/human-qualification.test.ts` — exact rule/mode review arguments and effects, decision matrix anti-replay/drift checks and human-terminal prerequisite.
- `scripts/fovea-control-cases.mjs` — exact-hash adoption, mode-setting and matched native approval/effect diagnostics; no automated approvals or native UI qualification claims.
- `scripts/fovea-session-probe.mjs` — real-Fabric TUI compact/swap/clear and same-MCP deferred-detach diagnostics, with bounded driver and witnessed transition acknowledgments.
- `tests/fovea/native-control-cases.test.ts` — generated guest typing, matched decisions and negative rule/mode/lifecycle/revocation evidence cases.
- `scripts/fovea-controls-probe.mjs` — opt-in current-bundle real-Fabric settings/reset/reload/resume diagnostic; private fixtures, exact native call evidence, no auto-approval or lifecycle pass claims.
- `tests/fovea/native-controls.test.ts` — rejects replay, wrong call/mode/session/input and false control-effect evidence; validates generated checked guest programs and opt-in profile boundaries.
- `scripts/fovea-approval-probe.mjs` — opt-in actual built-Fabric native form diagnostic with private ask-policy fixtures, correlated native/trace evidence and no auto-approval; never complete human or inventory qualification.
- `tests/fovea/native-approval.test.ts` — actual recorder envelopes, typed response identity, missing-handler versus decline, final-mode guards and unchanged effects.
- `scripts/fovea-lifecycle-probe.mjs` — opt-in bounded native resume/cancel/queue fixture with fresh recorder nonces and correlated acknowledgments; not actual Fabric lifecycle qualification.
- `tests/fovea/native-lifecycle.test.ts` — native identity/replay/order guards, surviving hooks, generated Tcl recorder and real fixture stdio/input boundaries.
- `tests/fovea/fixtures/lifecycle-contract-hook.mjs` — owned bounded hook-input recorder and cancellable-signal observation; no model context or continuation authority.
- `tests/fovea/fixtures/lifecycle-contract-mcp.mjs` — harmless nonce MCP recorder with instance identity; deliberately no invented native chat mapping.
- `scripts/release-native-evidence.mjs` — explicitly trusted-local read-only native smoke of exact schema-2 bundle/archive bytes, closure provenance and tools; never production promotion or installation.
- `tests/release-native-evidence.test.ts` — mismatched host/translation/archive/provenance refusal, spawn failure and byte-identity regression checks.
- `scripts/fovea-reference-diagnostics.mjs` — unchanged pinned cold reference/native repeats and exact graph identity preimages; multiset diagnostics never waive strict output parity.
- `tests/fovea/reference-diagnostics.test.ts` — identity reconstruction, empty-discovery refusal and order-only mismatch diagnostics without normalization.
- `scripts/prepare-complete-release.mjs` — exact clean-commit schema-2 candidate snapshots, release provenance before qualification, unsigned final-byte signing inputs and native smoke; no install or signing authority.
- `scripts/complete-release-signing-inputs.mjs` — all-target native evidence/witness capture and offline signing request creation, with no key access or signature generation.
- `scripts/complete-release-inputs.mjs` — bounded authenticated encrypted private-witness transport and allowlisted create-only extraction; never a signing or qualification authority.
- `tests/complete-release-inputs.test.ts` — ciphertext authentication, distinct nonces, wrong-secret refusal and pre-extraction path/digest/schema rejection.
- `scripts/complete-release-promotion.mjs` — static-root signed metadata and independently signed qualification, all-four-target exact archive/SPDX/closure checks, private witness binding and captured-byte bootstrap/asset publication.
- `tests/complete-release-fixture.ts` — four-target synthetic signed complete-bundle fixtures; no fixture binary is executed and keys are test-only.
- `tests/release-complete.test.ts` — exact captured promotion plus missing/stale/unsigned/tampered evidence, dirty source and offline ceremony guards.
- `tests/complete-release-workflow.test.ts` — protected manual candidate/promotion registration, signed tag/commit/origin checks, no signing secret exposure and inert hostile tag inputs.

## Continuity handoff, ACP probe, Fovea call contexts and installer TUI (current implementation)

- `src/continuity/conversation-archive.ts` — bounded conversation archive: append-only records, identity binding and tamper-evidence retention.
- `src/continuity/handoff.ts` — deterministic fresh-session handoff packets: pinned objective, constraints, open checks, resume prompt and stable packet hash.
- `src/continuity/rotation-journal.ts` — cross-schema rotation journal with CAS, abort, reconciliation and evidence retention.
- `src/continuity/validation.ts` — shared validation kernel for continuity records, views and handoff packets.
- `src/fovea/call-context.ts` — fovea call-context records joined for admission-qualified navigation.
- `src/kiro/acp-capability-probe.ts` — ACP transport capability probe with qualification lifecycle and fail-closed defaults.
- `src/kiro/acp-probe-contract.ts` — ACP wire-contract reader; documents the raw-byte cap a live transport must enforce before JSON parsing.
- `src/kiro/fovea-call-context.ts` — native fovea call-context capture, propagation and joining.
- `scripts/continuity-acp-probe.mjs` — offline ACP probe driver against the pinned wire fixture.
- `scripts/install-tui.mjs` — presentation-only installer TUI front-end delegating to install.sh --source.
- `tests/continuity-acp-probe.test.ts` — ACP probe contract, lifecycle and fault-injection coverage.
- `tests/continuity-archive.test.ts` — archive identity, retention and refusal behavior.
- `tests/continuity-handoff.test.ts` — handoff packet coverage, budgets and facade.
- `tests/continuity-recall.test.ts` — bounded recall and search pointer coverage.
- `tests/continuity-rotation.test.ts` — rotation journal CAS, abort and reconciliation.
- `tests/fovea/call-context.test.ts` — call-context record admission and shape.
- `tests/fovea/call-contexts.test.ts` — call-context joining across native fovea calls.
- `tests/fovea/mcp-call-context.test.ts` — MCP-layer call-context propagation.
- `tests/fovea/outline-structured.test.ts` — structured-outline demotion pins: real-binary behavior plus stub failure classes.
- `tests/fovea/source-retention.test.ts` — streaming source capture, warm snapshot reuse and retention bounds.
- `tests/state-durability.test.ts` — state-store durability fault matrix: committed versus acknowledged publication.

