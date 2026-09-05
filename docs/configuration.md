# Configuration

The Agent reads only `$KIRO_HOME/kiro-fabric/data/fabric/config/config.json`; configured MCP federation is in sibling `mcp.json`. Files must be non-symlink, single-link regular files within size bounds and, where POSIX ownership/mode checks are available, current-user-owned and private. Unknown fields, ambient imports, unsafe stdio/OAuth options, changed identities, and malformed configuration fail closed. Persistent configuration uses `schemaVersion: 1`. A valid legacy unversioned file is validated and migrated in memory without rewriting the user's file; newly generated and explicitly migrated configuration is versioned. Unsupported future versions and invalid legacy values are rejected without mutation.

`KIRO_FABRIC_RUNTIME_ROOT` and `KIRO_FABRIC_DATA_ROOT` are installer-owned launch values. `KIRO_FABRIC_DEBUG=1|0` controls tracing. Do not inject reserved `KIRO_FABRIC_*` variables from untrusted launch contexts.

## Execution admission and discovery bounds

`executor.maxConcurrentExecutions` defaults to **4** (allowed range 1–64). Each execution service admits at most this many requests across compilation, approval waits and guest execution. Excess requests fail immediately with `Fabric execution concurrency limit reached`; there is no hidden waiting queue. Completion, failure and cancellation release the slot. Closing a service rejects new executions, cancels admitted executions, waits for their bounded settlement, then tears down the registry; it closes only its own compiler pool. This is not proof that arbitrary downstream effects stopped after cancellation. Each service retains at most one idle compiler for 30 seconds; the standalone compiler helper has a separate four-worker bound. These are **per-service**, not process-wide or cross-process limits: embedders must also bound service creation.

Configured MCP discovery follows opaque cursors, including empty strings, under one shared discovery/call deadline and the existing server lease. Enumeration is bounded to 100 pages, 1,000 cumulative tools **before** allow/block filtering, 4,096 characters per cursor, and the existing JSON budget. Cycles, malformed pages and exhausted limits fail the operation rather than returning a deceptively complete partial catalog. These are safety ceilings, not measured throughput targets.

## State commit and retry semantics

State publication occurs at atomic rename after private permissions and file sync have succeeded. Ordinary failures before publication remove only the operation-owned temporary file and leave the previous document intact. Artifact write failures likewise remove the new file without adding it to quota accounting. Cleanup itself can fail on an unavailable filesystem; such failures are reported, not presented as successful cleanup.

A post-commit cancellation/deadline or lock-removal failure can reject an operation whose data is already visible. When the provider knows publication succeeded, the error reports `State mutation committed at revision N; acknowledgement failed; read state before retrying`. Do not interpret rejection as rollback. A transport interruption can also lose that acknowledgement: use `state.get` and `state.list` with a fresh request to reconcile entry/document revisions and the intended value or deletion before retrying. Use `expectedRevision` for subsequent writes; do not blindly replay uncertain operations. After a failed lock removal, the same provider retains the exact inode/device cleanup responsibility and retries it before another mutation; it will not remove a replacement lock. Persistent filesystem failure or loss of that provider instance can still require operator recovery after the owning process exits. Do not remove another live process's lock.

This is atomic publication and process-restart persistence, not a guarantee against machine power loss or arbitrary network-filesystem behavior. Directory fsync is attempted after memory rename/delete, but platform/filesystem responses that specifically mean directory open or sync is unsupported are best-effort; other directory I/O failures remain reported with truthful committed acknowledgement. No storage format migration or new transaction API is introduced.

## Clients without roots or elicitation

Fabric's fail-closed behavior assumes the Kiro client advertises MCP roots and answers form elicitations. Clients without those capabilities degrade, not crash:

- **No MCP roots capability**: `fabric_workspace` reports an explicitly-empty root list. Bind the workspace manually with the `attach` action and an absolute `path`; manual attachment itself requires form elicitation, so a client with neither capability cannot bind a workspace at all and workspace-scoped providers stay unavailable.
- **No form elicitation**: approval modes `read: "allow"`, `write: "ask"`, `execute: "ask"`, `network: "ask"` (the defaults) fail closed on every nested write/execute/network call. Set explicit `allow`/`deny` per risk in `data/fabric/config/config.json` (`approvals.write`, `approvals.execute`, `approvals.network`) to make the agent usable on such a client; that is a deliberate policy choice, not a workaround the installer performs for you.
- **Transient failures** are never treated as removal: a failed roots refresh reports a temporarily-unavailable workspace using the last verified root set, and never unbinds silently.

The generated agent profile deliberately omits `model`; `--v3` selects Kiro's V3 harness and is not a model name. The inline `mcpServers.fabric.requestTimeout` is 917000 ms: Fabric's 900000 ms maximum guest deadline plus the 10000 ms compiler allowance, 2000 ms outer cancellation grace, and a positive 5000 ms client-response margin. This keeps Kiro's client deadline strictly later than Fabric's own maximum request envelope.

By default, [Kiro custom agents inherit](https://kiro.dev/docs/custom-agents/configuration-reference/#disabling-default-resource-inheritance) default steering, skills, and `AGENTS.md`. Fabric preserves that Kiro default and its installer does not write Kiro settings. A user who wants only the resources named by custom-agent profiles can explicitly set:

```sh
kiro-cli settings chat.disableInheritingDefaultResources true
```

The setting is global and workspace-overridable. Re-enable inheritance by deleting the explicit setting:

```sh
kiro-cli settings --delete chat.disableInheritingDefaultResources
```

## Long-running chat context

Kiro, not Fabric, owns conversation persistence and compaction. Kiro's documented default is automatic compaction as a conversation approaches its compaction threshold; `/compact` requests it immediately. Fabric installation does not change `chat.disableAutoCompaction`. Inspect the effective explicit value with:

```sh
kiro-cli settings chat.disableAutoCompaction --format json
```

`null` means no explicit override. A user who previously disabled automatic compaction can explicitly re-enable it with:

```sh
kiro-cli settings chat.disableAutoCompaction false
```

This setting does not control the Fabric MCP lifecycle. Within one active Kiro CLI process, ordinary turns and compaction must keep the same Fabric MCP PID/instance and the same runtime generation for an unchanged workspace. That invariant remains an authenticated exact-release-SHA qualification gate, not a behavior claimed from component tests alone. Fabric memory/state is global-data-root-backed and workspace-scoped; do not use it as a duplicate conversation transcript. TTL artifacts and in-memory values are intentionally ephemeral.

Memory mutations can fail after their atomic rename/delete has already become visible, including during deadline checks or exact-identity lock cleanup. Such failures explicitly say the mutation **committed** and instruct callers to read the key before retrying. That bounded acknowledgement (action reference and set/delete operation only) survives an outer cancellation/deadline result; it never includes the memory key, value, or underlying error cause. Errors without that acknowledgement, including pre-publication failures and no-op deletes, do not claim a commit. Cleanup retries retain descriptor/inode identity evidence where available and refuse to remove unidentified, foreign, or replacement locks; unverifiable initialization reports unresolved cleanup rather than deleting by pathname.
